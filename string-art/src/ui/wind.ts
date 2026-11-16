// The Wind panel: drive the machine from the page over USB. Connect, home, jog, set the zero, send the settings, then
// start the winding from line 1 (or any line), pause, resume, stop, go back a few lines after a thread break, change
// the speed. The simulator follows the real machine, and the last finished line is saved for the sequence, so after a
// power cut the winding carries on from where it stopped.

import { pitchDeg, xSpeedLimit, type MachineConfig } from "../machine/config";
import { program, resumeProgram } from "../machine/gcode";
import { RT, Streamer, type PauseReason, type Status, type StreamEvent } from "../machine/grbl";
import type { Plan } from "../machine/toolpath";
import { grblSettings } from "../hardware/drive";
import { sequenceId } from "../export/instructions";
import { SerialLink, serialSupported } from "./serial";
import { T, fx, int } from "./i18n";

export interface WindContext {
  piece(): { seq: Uint16Array; nails: number } | null;
  plan(): Plan | null;
  cfg(): MachineConfig;
  /** show the machine at this time of the plan in the simulator */
  follow(time: number): void;
  canWind(): boolean;
}

const KEY = "sa-wind-v1-";
const $ = <E extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as E;

export function mountWind(ctx: WindContext): void {
  if (!serialSupported()) { $("wdNoSerial").hidden = false; $("wdConnectBar").hidden = true; return; }

  let link: SerialLink | null = null, streamer: Streamer | null = null, poll = 0;
  let status: Status | null = null, jobLines = 0, jobFrom = 1, lastLine = 0, step = 1;
  let jobPlan: Plan | null = null, jobSeq: Uint16Array | null = null;   // what is being wound, even if the settings change
  const log: string[] = [];
  const say = (s: string) => { log.push(s); if (log.length > 300) log.splice(0, log.length - 300); $("wdLog").textContent = log.join("\n"); };

  const seqId = () => { const p = ctx.piece(); return p ? sequenceId(p.seq) : ""; };
  const saved = (): number => { try { const v = Number(localStorage.getItem(KEY + seqId())); return Number.isFinite(v) ? v : 0; } catch { return 0; } };
  const save = (k: number) => { try { localStorage.setItem(KEY + seqId(), String(k)); } catch { /* not remembered */ } };

  function notice(text: string, kind: "info" | "warn" | "bad" = "info"): void {
    const n = $("wdNotice");
    n.hidden = !text; n.className = "wnotice " + kind; n.innerHTML = text;
  }

  function pauseText(r: PauseReason, line: number): string {
    const p = ctx.piece(), seq = p?.seq;
    switch (r) {
      case "tieOn": return T("<b>Tie the thread to nail {n}</b>, check it runs freely from the spool through the guide, then press Resume.", { n: seq ? seq[Math.max(0, line - 1)] : 0 });
      case "check": return T("<b>Planned stop after {n} lines.</b> Check the thread and the tension, then press Resume.", { n: int(line - 1) });
      case "done": return T("<b>Finished!</b> Tie the thread off at nail {n}, then press Resume to lift the guide clear.", { n: seq ? seq[seq.length - 1] : 0 });
      case "user": return T("<b>Paused</b> at about line {n}. Resume, stop, or go back a few lines.", { n: int(line) });
      case "hold": return T("<b>The machine stopped on its own</b> at about line {n}: the thread may have broken or run out. Mend it and press Resume, or go back a few lines and wind them again.", { n: int(line) });
    }
  }

  function setButtons(): void {
    const on = !!link?.open, job = !!streamer?.job, busy = !!streamer?.running, paused = !!streamer?.paused;
    const idle = status?.state === "Idle", alarm = status?.state === "Alarm";
    $("wdPanel").hidden = !on;
    $("wdConnect").textContent = on ? T("Connected") : T("Connect the machine");
    ($("wdConnect") as HTMLButtonElement).disabled = on;
    for (const id of ["wdHome", "wdSettings", "wdZero"]) ($(id) as HTMLButtonElement).disabled = !on || busy || !(idle || alarm);
    ($("wdUnlock") as HTMLButtonElement).disabled = !on || busy;
    document.querySelectorAll<HTMLButtonElement>("[data-jog]").forEach((b) => { b.disabled = !on || busy || !idle; });
    ($("wdStart") as HTMLButtonElement).disabled = !on || busy || !idle || !ctx.canWind();
    ($("wdPause") as HTMLButtonElement).disabled = !job || paused;
    ($("wdResume") as HTMLButtonElement).disabled = !job || !paused;
    ($("wdStop") as HTMLButtonElement).disabled = !job;
    ($("wdBack") as HTMLButtonElement).disabled = !job || !paused;
    for (const id of ["wdSlower", "wdFaster", "wdFeed100"]) ($(id) as HTMLButtonElement).disabled = !on;
    ($("wdSend") as HTMLButtonElement).disabled = !on || busy;
  }

  function showState(): void {
    const s = status;
    const names: Record<string, string> = { Idle: T("ready"), Run: T("running"), Hold: T("holding"), Jog: T("jogging"), Alarm: T("alarm"), Home: T("homing"), Door: T("door open"), Check: T("check mode"), Sleep: T("asleep"), Unknown: "?" };
    $("wdState").textContent = !link?.open ? "" : !s ? T("waiting for the controller…")
      : `${names[s.state] ?? s.state}${s.wpos ? ` · X ${fx(s.wpos[0], 2)}° · Y ${fx(s.wpos[1], 2)} · Z ${fx(s.wpos[2], 2)} mm` : ""}`;
    $("wdState").className = "wstate " + (s?.state === "Alarm" ? "bad" : s?.state === "Hold" ? "warn" : s?.state === "Run" ? "good" : "");
    $("wdFeed").textContent = s?.ov ? T("feed {f} %", { f: s.ov[0] }) : "";
  }

  function onEvent(e: StreamEvent): void {
    switch (e.type) {
      case "status": status = e.status; showState(); break;
      case "reply": say("< " + e.text); break;
      case "progress": {
        const p = jobPlan;
        if (e.move >= 0 && p) ctx.follow(p.t0[e.move] + p.dur[e.move]);
        const line = e.move >= 0 && p ? p.line[e.move] : e.line;
        if (line !== lastLine) {
          lastLine = line;
          // a line is finished once the machine has carried out its last move
          const finished = p && e.move >= 0 && p.lineEnd[line] === e.move ? line : line - 1;
          if (finished >= 1) save(finished);
        }
        const L = p?.lines ?? 0;
        ($("wdBar").firstElementChild as HTMLElement).style.width = `${L ? Math.round((Math.max(0, lastLine) / L) * 1000) / 10 : 0}%`;
        $("wdProgress").textContent = T("Line {k} of {l} · {a} of {t} commands sent", { k: int(lastLine), l: int(L), a: int(e.acked), t: int(jobLines) });
        break;
      }
      case "paused": notice(pauseText(e.reason, e.line || lastLine), e.reason === "hold" ? "bad" : e.reason === "done" ? "info" : "warn"); say(`! ${e.reason}`); break;
      case "resumed": notice(""); break;
      case "error": notice(T("The controller refused line {l} (error {c}: <code>{t}</code>). The winding is held: resume to skip it, or stop.", { l: int(e.line), c: e.code, t: e.text }), "bad"); say(`< error:${e.code} for ${e.text}`); break;
      case "alarm": notice(T("Alarm {c}: the controller has stopped and needs unlocking ($X) or homing. If the board turned while stopped, set the zero again.", { c: e.code }), "bad"); say(`< ALARM:${e.code}`); break;
      case "done":
        if (jobLines) {
          notice(T("The winding is finished: {n} lines.", { n: int(jobPlan?.lines ?? 0) }), "info");
          save(jobPlan?.lines ?? 0);
          ($("wdFrom") as HTMLInputElement).value = "1";        // the next piece starts from the beginning
        }
        jobLines = 0;
        break;
      case "stopped": {
        const k = Math.max(1, Math.round(Number(($("wdFrom") as HTMLInputElement).value) || 1));
        if (jobLines && jobSeq) notice(T("Stopped; the position is kept. To carry on, unwind the thread back to nail {n} and start from line {k}.", { n: jobSeq[k - 1], k: int(k) }), "warn");
        jobLines = 0;
        break;
      }
    }
    setButtons();
  }

  async function connect(): Promise<void> {
    link = new SerialLink((line) => streamer?.receive(line), (err) => {
      clearInterval(poll); streamer = null; status = null;
      notice(err ? T("The connection to the controller was lost.") : "", "bad");
      showState(); setButtons();
    });
    try { await link.connect(); }
    catch { link = null; return; }               // the picker was closed
    streamer = new Streamer({ write: (s) => { link?.write(s); } }, onEvent);
    poll = window.setInterval(() => streamer?.poll(), 250);
    say(T("Connected. GRBL answers with a welcome line; press Unlock or Home if it reports an alarm."));
    const L = ctx.plan()?.lines ?? 1, done = saved();              // carry on where the last session stopped
    ($("wdFrom") as HTMLInputElement).value = String(done >= 1 && done < L ? done + 1 : 1);
    setButtons();
  }

  function start(): void {
    const p = ctx.piece(), plan = ctx.plan();
    if (!p || !plan || !streamer) return;
    const k = Math.max(1, Math.min(plan.lines, Math.round(Number(($("wdFrom") as HTMLInputElement).value) || 1)));
    const lines = k === 1 ? program(p.seq, plan, ctx.cfg()) : resumeProgram(p.seq, plan, ctx.cfg(), k, status?.wpos?.[0] ?? 0);
    jobLines = lines.filter((l) => l.text.split(";")[0].trim()).length;
    jobFrom = k; lastLine = k - 1; jobPlan = plan; jobSeq = p.seq;
    notice(k === 1 ? "" : T("Starting at line {k}: the guide rises, goes inside the ring and turns to nail {n}, then stops for the thread.", { k: int(k), n: p.seq[k - 1] }), "info");
    say(T("Winding from line {k}.", { k: int(jobFrom) }));
    streamer.start(lines);
    setButtons();
  }

  // ---------------------------------------------------------------- wiring the buttons
  $("wdConnect").addEventListener("click", () => { void connect(); });
  $("wdDisconnect").addEventListener("click", () => { clearInterval(poll); void link?.disconnect(); link = null; streamer = null; status = null; showState(); setButtons(); });
  $("wdHome").addEventListener("click", () => streamer?.command(["$H"]));
  $("wdUnlock").addEventListener("click", () => { if (streamer?.running) return; streamer?.command(["$X"]); });
  $("wdSettings").addEventListener("click", () => { streamer?.command(grblSettings(ctx.cfg()).map(([s]) => s)); say(T("Sending the settings, one at a time.")); });
  $("wdZero").addEventListener("click", () => {
    streamer?.command([`G10 L20 P1 X0 Y0 Z${ctx.cfg().nailHeightMm}`]);
    say(T("Zero set: X0 at nail 0, Y0 on the nail circle, Z at the nail tops."));
  });
  document.querySelectorAll<HTMLButtonElement>("#wdStep button").forEach((b) => b.addEventListener("click", () => {
    step = Number(b.dataset.v);
    document.querySelectorAll("#wdStep button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  }));
  document.querySelectorAll<HTMLButtonElement>("[data-jog]").forEach((b) => b.addEventListener("click", () => {
    const c = ctx.cfg(), axis = b.dataset.jog![0], sign = b.dataset.jog![1] === "-" ? -1 : 1;
    const d = axis === "X" ? pitchDeg(c) : step, f = axis === "X" ? xSpeedLimit(c) * 60 : axis === "Y" ? c.ySpeed * 60 : c.zSpeed * 60;
    streamer?.command([`$J=G91 G21 ${axis}${(sign * d).toFixed(3)} F${Math.round(Math.min(f, 1200))}`]);
  }));
  $("wdStart").addEventListener("click", start);
  $("wdPause").addEventListener("click", () => streamer?.pause());
  $("wdResume").addEventListener("click", () => streamer?.resume());
  $("wdStop").addEventListener("click", () => {
    ($("wdFrom") as HTMLInputElement).value = String(Math.max(1, lastLine));
    streamer?.stop();
  });
  $("wdBack").addEventListener("click", () => {
    const n = Math.max(1, Math.round(Number(($("wdBackN") as HTMLInputElement).value) || 1));
    ($("wdFrom") as HTMLInputElement).value = String(Math.max(1, lastLine - n));
    streamer?.stop();
  });
  $("wdSlower").addEventListener("click", () => link?.write(RT.feedDown10));
  $("wdFaster").addEventListener("click", () => link?.write(RT.feedUp10));
  $("wdFeed100").addEventListener("click", () => link?.write(RT.feed100));
  const sendCmd = () => {
    const inp = $("wdCmd") as HTMLInputElement, t = inp.value.trim();
    if (!t || !streamer || streamer.running) return;
    say("> " + t); streamer.command([t]); inp.value = "";
  };
  $("wdSend").addEventListener("click", sendCmd);
  $("wdCmd").addEventListener("keydown", (e) => { if ((e as KeyboardEvent).key === "Enter") sendCmd(); });
  setButtons();
}
