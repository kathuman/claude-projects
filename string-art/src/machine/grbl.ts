// Talking to GRBL 1.1: reading its replies and streaming a program to it. No DOM and no serial port here: the sender
// writes through a `Transport` and is fed GRBL's lines one at a time, so the tests can run it against a fake GRBL.
//
// Streaming uses GRBL's character counting: GRBL has a 128-byte receive buffer, and every line it has finished with
// is answered with "ok" (or "error:n"). The sender keeps a running count of the bytes it has sent but not yet had
// answered and sends the next line as soon as it fits. That keeps GRBL's planner full, so the machine moves without
// stopping between lines. Settings ($n=v) go one at a time instead, as GRBL asks, because writing them to EEPROM
// pauses its serial reception.
//
// Three things stop the machine, and the sender tells them apart:
//   the program's own M0   GRBL stops at it in Hold and answers the M0 line only once resumed, so while it waits
//                          the M0 is the first line still unanswered
//   the Pause button       the sender sends "!" (feed hold) and remembers it did
//   the thread-break switch, wired to GRBL's Hold input: GRBL goes to Hold without either of the above (Pn shows H)

import type { ProgramLine } from "./gcode";

export type GrblState = "Idle" | "Run" | "Hold" | "Jog" | "Alarm" | "Door" | "Check" | "Home" | "Sleep" | "Unknown";

export interface Status {
  state: GrblState;
  sub: number | null;
  wpos: [number, number, number] | null;
  /** planner blocks free, receive-buffer bytes free */
  bf: [number, number] | null;
  /** feed, rapid and spindle overrides, % */
  ov: [number, number, number] | null;
  /** input pins that are active: X Y Z (limits), H (hold), R (reset), S (cycle start), D (door) */
  pins: string;
}

const STATES: GrblState[] = ["Idle", "Run", "Hold", "Jog", "Alarm", "Door", "Check", "Home", "Sleep"];
const nums = (s: string) => s.split(",").map(Number);

/**
 * Parse a status report such as <Hold:0|WPos:12.000,-8.000,3.300|Bf:15,128|Ov:100,100,100|Pn:H>. GRBL sends either
 * WPos, or MPos with an occasional WCO (work coordinate offset); `wco` carries the last WCO between reports.
 */
export function parseStatus(line: string, wco: { v: [number, number, number] | null } = { v: null }): Status | null {
  const m = /^<([^>]*)>$/.exec(line.trim());
  if (!m) return null;
  const parts = m[1].split("|");
  const [name, sub] = parts[0].split(":");
  const st: Status = { state: (STATES as string[]).includes(name) ? (name as GrblState) : "Unknown", sub: sub != null ? Number(sub) : null, wpos: null, bf: null, ov: null, pins: "" };
  let mpos: number[] | null = null;
  for (const p of parts.slice(1)) {
    const [k, v] = [p.slice(0, p.indexOf(":")), p.slice(p.indexOf(":") + 1)];
    if (k === "WPos") st.wpos = nums(v).slice(0, 3) as [number, number, number];
    else if (k === "MPos") mpos = nums(v);
    else if (k === "WCO") wco.v = nums(v).slice(0, 3) as [number, number, number];
    else if (k === "Bf") st.bf = nums(v).slice(0, 2) as [number, number];
    else if (k === "Ov") st.ov = nums(v).slice(0, 3) as [number, number, number];
    else if (k === "Pn") st.pins = v;
  }
  if (!st.wpos && mpos) {
    const o = wco.v ?? [0, 0, 0];
    st.wpos = [mpos[0] - o[0], mpos[1] - o[1], mpos[2] - o[2]];
  }
  return st;
}

/** The text GRBL is sent for a program line: no comment, no surrounding space; "" if nothing is left. */
export function clean(text: string): string {
  return text.replace(/\(.*?\)/g, "").split(";")[0].trim();
}

/** GRBL's real-time commands: single bytes acted on at once, never queued. */
export const RT = {
  status: "?", hold: "!", resume: "~", reset: "\x18", jogCancel: "\x85",
  feed100: "\x90", feedUp10: "\x91", feedDown10: "\x92"
} as const;

export interface Transport { write(s: string): void }

export type PauseReason = "tieOn" | "check" | "done" | "user" | "hold";

export type StreamEvent =
  | { type: "progress"; acked: number; total: number; line: number; move: number }
  | { type: "paused"; reason: PauseReason; line: number }
  | { type: "resumed" }
  | { type: "error"; code: number; text: string; line: number }
  | { type: "alarm"; code: number }
  | { type: "done" }
  | { type: "stopped" }
  | { type: "status"; status: Status }
  | { type: "reply"; text: string };

interface Sent { idx: number; len: number }

/** GRBL's receive buffer is 128 bytes; one is kept spare. */
export const RX_SIZE = 127;

export class Streamer {
  private lines: ProgramLine[] = [];
  private send: number[] = [];         // indices into `lines` that are sent (comments and blanks skipped)
  private next = 0;                    // next entry of `send` to write
  private inFlight: Sent[] = [];
  private bytes = 0;
  private mode: "idle" | "job" | "cmd" = "idle";
  private ackedMotion: number[] = [];  // program-line indices of motion lines GRBL has taken
  private plannerSize = 0;             // the largest "planner blocks free" seen: the planner's size
  private status: Status | null = null;
  private userPaused = false;
  private pausedFor: PauseReason | null = null;
  private stopping = false;
  private wco: { v: [number, number, number] | null } = { v: null };

  constructor(private t: Transport, private on: (e: StreamEvent) => void) {}

  get running(): boolean { return this.mode !== "idle"; }
  get job(): boolean { return this.mode === "job"; }
  get last(): Status | null { return this.status; }
  get paused(): PauseReason | null { return this.pausedFor; }

  /** Stream a program (character counting). */
  start(lines: ProgramLine[]): void {
    if (this.running) throw new Error("busy");
    this.load(lines, "job");
  }

  /** Send commands one at a time, each after the last is answered (settings, homing, jogging, single commands). */
  command(cmds: string[]): void {
    if (this.running) throw new Error("busy");
    this.load(cmds.map((text) => ({ text, move: -1, line: 0 })), "cmd");
  }

  private load(lines: ProgramLine[], mode: "job" | "cmd"): void {
    this.lines = lines; this.mode = mode;
    this.send = [];
    lines.forEach((l, i) => { if (clean(l.text)) this.send.push(i); });
    this.next = 0; this.inFlight = []; this.bytes = 0; this.ackedMotion = [];
    this.userPaused = false; this.pausedFor = null; this.stopping = false;
    this.pump();
  }

  private pump(): void {
    if (this.mode === "idle" || this.stopping || this.pausedFor === "user") return;
    while (this.next < this.send.length) {
      if (this.mode === "cmd" && this.inFlight.length > 0) break;
      const idx = this.send[this.next], text = clean(this.lines[idx].text), len = text.length + 1;
      if (this.bytes + len > RX_SIZE) break;
      this.t.write(text + "\n");
      this.inFlight.push({ idx, len });
      this.bytes += len;
      this.next++;
    }
  }

  /** Everything sent and answered, and nothing holding the job (an error holds it until resumed or stopped). */
  private finished(): boolean { return this.next >= this.send.length && this.inFlight.length === 0 && this.pausedFor !== "user"; }

  /** Ask for a status report (call it a few times a second). */
  poll(): void { this.t.write(RT.status); }

  pause(): void {
    if (!this.running || this.pausedFor) return;
    this.userPaused = true;
    this.t.write(RT.hold);
  }

  resume(): void {
    if (!this.pausedFor && !this.userPaused) return;
    this.userPaused = false; this.pausedFor = null;
    this.t.write(RT.resume);
    this.on({ type: "resumed" });
    if (this.finished()) this.end("done");
    else this.pump();
  }

  /** Stop the program: hold first so the machine decelerates and keeps its position, then reset once it has stopped. */
  stop(): void {
    if (!this.running) return;
    this.stopping = true;
    this.t.write(RT.hold);
    if (this.status?.state === "Hold" && this.status.sub === 0) this.finishStop();
    else if (this.status?.state === "Idle") this.finishStop();
  }

  private finishStop(): void {
    this.t.write(RT.reset);
    this.end("stopped");
  }

  private end(type: "done" | "stopped"): void {
    this.mode = "idle"; this.inFlight = []; this.bytes = 0; this.stopping = false; this.pausedFor = null; this.userPaused = false;
    this.on({ type });
  }

  /** The plan move of the last motion line the machine has completed, judged from the planner's fill. */
  executedMove(): number {
    const bf = this.status?.bf;
    const queued = bf && this.plannerSize ? Math.max(0, this.plannerSize - bf[0]) : 0;
    const n = this.ackedMotion.length - queued;
    return n > 0 ? this.lines[this.ackedMotion[n - 1]].move : -1;
  }

  /** Feed one line from GRBL. */
  receive(raw: string): void {
    const line = raw.trim();
    if (!line) return;
    if (line.startsWith("<")) { this.onStatus(line); return; }
    if (line === "ok" || line.startsWith("error:")) {
      const head = this.inFlight.shift();
      if (head) this.bytes -= head.len;
      if (!head || this.mode === "idle") { this.on({ type: "reply", text: line }); return; }
      const pl = this.lines[head.idx];
      if (line.startsWith("error:")) {
        const code = Number(line.slice(6));
        this.on({ type: "error", code, text: clean(pl.text), line: pl.line });
        if (this.mode === "job") { this.userPaused = true; this.t.write(RT.hold); this.pausedFor = "user"; return; }
      } else {
        if (pl.move >= 0) this.ackedMotion.push(head.idx);
      }
      if (this.mode === "job") this.on({ type: "progress", acked: this.next - this.inFlight.length, total: this.send.length, line: pl.line, move: this.executedMove() });
      if (this.finished()) { this.end("done"); return; }
      this.pump();
      return;
    }
    if (line.startsWith("ALARM:")) {
      this.on({ type: "alarm", code: Number(line.slice(6)) });
      if (this.running) this.end("stopped");
      return;
    }
    if (/^Grbl /.test(line)) {             // GRBL has reset: anything in flight is gone
      if (this.running && !this.stopping) this.end("stopped");
      this.on({ type: "reply", text: line });
      return;
    }
    this.on({ type: "reply", text: line });
  }

  private onStatus(line: string): void {
    const st = parseStatus(line, this.wco);
    if (!st) return;
    this.status = st;
    if (st.bf) this.plannerSize = Math.max(this.plannerSize, st.bf[0]);
    this.on({ type: "status", status: st });
    if (this.stopping && ((st.state === "Hold" && st.sub === 0) || st.state === "Idle")) { this.finishStop(); return; }
    if (this.mode !== "job") return;
    if (st.state === "Hold" && !this.pausedFor) {
      const head = this.inFlight[0], pl = head ? this.lines[head.idx] : null;
      const reason: PauseReason = this.userPaused ? "user" : pl?.pause ?? "hold";
      this.pausedFor = reason;
      this.on({ type: "paused", reason, line: pl?.pause ? pl.line : this.lineOfExecuted() });
    }
    if ((st.state === "Run" || st.state === "Idle") && this.pausedFor && this.pausedFor !== "user") {
      this.pausedFor = null;                // resumed from the machine's own cycle-start button
      this.on({ type: "resumed" });
    }
  }

  private lineOfExecuted(): number {
    const m = this.executedMove();
    for (let i = this.ackedMotion.length - 1; i >= 0; i--) if (this.lines[this.ackedMotion[i]].move === m) return this.lines[this.ackedMotion[i]].line;
    return 0;
  }
}
