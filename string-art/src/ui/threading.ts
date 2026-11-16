// The threading mode: a full-screen guide for winding the piece at the board.
//
// It shows the next nail very large, the nail the thread is at, the three nails before and the three after, and a
// small board with the lines wound so far (faint) and the next line (highlighted). Space, Enter or → advance; ← goes
// back; Esc closes. The position is saved after every step under the sequence's id (export/instructions.ts:
// sequenceId), so closing the page and coming back resumes at the same line. It can read the next nail number aloud
// (Web Speech API, in the page's language) and asks the browser to keep the screen awake while it is open.

import { threadingView } from "../core/threading";
import { sequenceId } from "../export/instructions";
import { LANGS, T, int, lang } from "./i18n";
import { loadThreadPos, saveThreadPos } from "./store";

type WakeLock = { release(): Promise<void> };

export class ThreadingMode {
  private seq = new Uint16Array(1);
  private nails = 1;
  private id = "";
  private pos = 0;
  private wake: WakeLock | null = null;
  private $ = (id: string) => this.root.querySelector<HTMLElement>("#" + id)!;

  constructor(private root: HTMLElement) {
    this.$("tmClose").addEventListener("click", () => this.close());
    this.$("tmNextBtn").addEventListener("click", () => this.go(this.pos + 1));
    this.$("tmBack").addEventListener("click", () => this.go(this.pos - 1));
    this.$("tmGo").addEventListener("click", () => this.go(Number((this.$("tmGoto") as HTMLInputElement).value)));
    this.$("tmFull").addEventListener("click", () => {
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
      else void this.root.requestFullscreen?.().catch(() => undefined);
    });
    const speak = this.$("tmSpeak") as HTMLInputElement;
    if (!("speechSynthesis" in window)) this.$("tmSpeakWrap").hidden = true;
    try { speak.checked = localStorage.getItem("sa-speak") === "1"; } catch { /* not remembered */ }
    speak.addEventListener("change", () => {
      try { localStorage.setItem("sa-speak", speak.checked ? "1" : "0"); } catch { /* not remembered */ }
      if (speak.checked) this.say();
    });
    document.addEventListener("keydown", (e) => {
      if (this.root.hidden || (e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.key === " " || e.key === "Enter" || e.key === "ArrowRight") { e.preventDefault(); this.go(this.pos + 1); }
      else if (e.key === "ArrowLeft" || e.key === "Backspace") { e.preventDefault(); this.go(this.pos - 1); }
      else if (e.key === "Escape" && !document.fullscreenElement) this.close();
    });
    document.addEventListener("visibilitychange", () => { if (!this.root.hidden && document.visibilityState === "visible") void this.lockScreen(); });
    new ResizeObserver(() => { if (!this.root.hidden) this.draw(); }).observe(this.$("tmCanvas"));
  }

  get isOpen(): boolean { return !this.root.hidden; }
  get position(): number { return this.pos; }

  open(seq: Uint16Array, nails: number): void {
    this.seq = seq; this.nails = nails; this.id = sequenceId(seq);
    this.pos = loadThreadPos(this.id);
    (this.$("tmGoto") as HTMLInputElement).max = String(seq.length - 1);
    this.root.hidden = false;
    document.body.classList.add("tm-open");
    void this.lockScreen();
    this.render();
    this.$("tmNextBtn").focus();
    this.say();
  }

  close(): void {
    this.root.hidden = true;
    document.body.classList.remove("tm-open");
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    void this.wake?.release().catch(() => undefined);
    this.wake = null;
  }

  go(p: number): void {
    const v = threadingView(this.seq, p);
    if (v.done === this.pos && p !== this.pos) return;   // already at an end
    this.pos = v.done;
    saveThreadPos(this.id, this.pos);
    this.render();
    this.say();
  }

  private async lockScreen(): Promise<void> {
    try {
      const nav = navigator as Navigator & { wakeLock?: { request(t: "screen"): Promise<WakeLock> } };
      if (nav.wakeLock && !this.wake) this.wake = await nav.wakeLock.request("screen");
    } catch { this.wake = null; }   // not supported or not allowed: the screen may sleep
  }

  private say(): void {
    const speak = this.$("tmSpeak") as HTMLInputElement;
    if (!speak.checked || !("speechSynthesis" in window)) return;
    const v = threadingView(this.seq, this.pos);
    const u = new SpeechSynthesisUtterance(v.finished ? T("Finished.") : String(v.to));
    u.lang = LANGS[lang].html; u.rate = 0.95;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }

  private render(): void {
    const v = threadingView(this.seq, this.pos);
    this.$("tmStep").textContent = T("Line {n} of {t}", { n: int(Math.min(v.total, v.done + 1)), t: int(v.total) });
    const nail = this.$("tmNail");
    nail.classList.toggle("done", v.finished);
    nail.textContent = v.finished ? T("Done! Tie the thread off at nail {n}.", { n: v.from }) : String(v.to);
    this.$("tmFrom").textContent = v.finished ? "" : T("from nail {n}", { n: v.from });
    this.$("tmPrev").innerHTML = v.prev.length ? v.prev.concat([v.from]).map((n, i, a) => (i === a.length - 1 ? `<b>${n}</b>` : String(n))).join(" → ") : `<b>${v.from}</b>`;
    this.$("tmAfter").textContent = v.next.length ? v.next.join(" → ") : "—";
    (this.$("tmBar").firstElementChild as HTMLElement).style.width = `${(100 * v.done) / Math.max(1, v.total)}%`;
    (this.$("tmGoto") as HTMLInputElement).value = String(v.done);
    (this.$("tmBack") as HTMLButtonElement).disabled = v.done === 0;
    (this.$("tmNextBtn") as HTMLButtonElement).disabled = v.finished;
    this.draw();
  }

  /** The board: nails, the lines wound so far (faint), the next line (bold), and its two nails. */
  private draw(): void {
    const cv = this.$("tmCanvas") as HTMLCanvasElement, S = Math.max(64, Math.round(cv.clientWidth * (window.devicePixelRatio || 1)));
    if (cv.width !== S) { cv.width = S; cv.height = S; }
    const g = cv.getContext("2d")!, R = S / 2 - S * 0.04, c = S / 2, n = this.nails;
    const at = (i: number): [number, number] => { const t = -Math.PI / 2 + (2 * Math.PI * i) / n; return [c + R * Math.cos(t), c + R * Math.sin(t)]; };
    g.fillStyle = "#fff"; g.fillRect(0, 0, S, S);
    g.strokeStyle = "rgba(0,0,0,0.13)"; g.lineWidth = Math.max(0.6, S / 900);
    g.beginPath();
    for (let s = 1; s <= this.pos; s++) { const [x0, y0] = at(this.seq[s - 1]), [x1, y1] = at(this.seq[s]); g.moveTo(x0, y0); g.lineTo(x1, y1); }
    g.stroke();
    g.fillStyle = "#8a96a3";
    const dot = Math.max(1.2, S / 400);
    for (let i = 0; i < n; i++) { const [x, y] = at(i); g.beginPath(); g.arc(x, y, dot, 0, Math.PI * 2); g.fill(); }
    const v = threadingView(this.seq, this.pos);
    const [fx0, fy0] = at(v.from);
    if (v.to != null) {
      const [tx, ty] = at(v.to);
      g.strokeStyle = "#e0482f"; g.lineWidth = Math.max(2, S / 160);
      g.beginPath(); g.moveTo(fx0, fy0); g.lineTo(tx, ty); g.stroke();
      g.fillStyle = "#e0482f"; g.beginPath(); g.arc(tx, ty, dot * 4, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = "#1a5fb4"; g.beginPath(); g.arc(fx0, fy0, dot * 3, 0, Math.PI * 2); g.fill();
  }
}
