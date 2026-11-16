// The USB link to the controller, through the browser's Web Serial API (Chrome and Edge on a computer). It hands GRBL's
// replies over one line at a time and writes in order. The page must ask for the port from a click: browsers only show
// the port picker in answer to the user.

interface SerialPortLike {
  open(o: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
}
interface SerialLike { requestPort(): Promise<SerialPortLike> }

export const serialSupported = (): boolean => typeof navigator !== "undefined" && "serial" in navigator;

export class SerialLink {
  private port: SerialPortLike | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private chain: Promise<void> = Promise.resolve();
  private enc = new TextEncoder();

  constructor(private onLine: (line: string) => void, private onClose: (error: unknown) => void) {}

  get open(): boolean { return !!this.port; }

  /** Ask for the port (shows the browser's picker) and open it at GRBL's 115200 baud. */
  async connect(baudRate = 115200): Promise<void> {
    const serial = (navigator as unknown as { serial: SerialLike }).serial;
    const port = await serial.requestPort();
    await port.open({ baudRate });
    this.port = port;
    this.writer = port.writable!.getWriter();
    void this.readLoop(port);
  }

  private async readLoop(port: SerialPortLike): Promise<void> {
    const dec = new TextDecoder();
    let buf = "", error: unknown = null;
    try {
      this.reader = port.readable!.getReader();
      for (;;) {
        const { value, done } = await this.reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.search(/\r?\n/)) >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + (buf[nl] === "\r" ? 2 : 1));
          if (line.trim()) this.onLine(line);
        }
      }
    } catch (e) { error = e; }
    this.port = null;
    this.onClose(error);
  }

  /** Write in order; GRBL's replies come back through onLine. */
  write(s: string): void {
    const w = this.writer;
    if (!w) return;
    // real-time bytes (0x80 and up) are written raw, not as UTF-8
    const bytes = /[\x80-\xff]/.test(s) ? Uint8Array.from(s, (ch) => ch.charCodeAt(0) & 0xff) : this.enc.encode(s);
    this.chain = this.chain.then(() => w.write(bytes)).catch(() => undefined);
  }

  async disconnect(): Promise<void> {
    const port = this.port;
    this.port = null;
    try { await this.reader?.cancel(); } catch { /* already closed */ }
    try { this.reader?.releaseLock(); } catch { /* */ }
    try { await this.chain; this.writer?.releaseLock(); } catch { /* */ }
    try { await port?.close(); } catch { /* */ }
    this.reader = null; this.writer = null;
  }
}
