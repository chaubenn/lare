import { PROTOCOL_VERSION, WS_URL } from "@lare/shared";

export function gradingCapable(ack: unknown, userId: string | null): boolean {
  const a = ack as { protocol?: number; userId?: string; capabilities?: string[] } | null;
  return (
    !!userId &&
    a?.protocol === PROTOCOL_VERSION &&
    a.userId === userId &&
    Array.isArray(a.capabilities) &&
    a.capabilities.includes("pcm16k-f32-v1")
  );
}

/** Retain only unacknowledged samples; a bounded queue fails grading, never video. */
export class PcmStream {
  private ws: WebSocket | null = null;
  private chunks: { start: number; data: Float32Array }[] = [];
  private total = 0;
  private acked = 0;
  private ready = false;
  private ended = false;
  private failed = false;
  private complete = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(
    private sessionId: string,
    private userId: string,
    private report: (message: string, failed?: boolean, transcript?: string) => void,
  ) {}
  async start() {
    await this.connect();
  }
  private connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(WS_URL);
      this.ws = ws;
      this.ready = false;
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error("Desktop PCM handshake timed out"));
      }, 5000);
      ws.onopen = () =>
        ws.send(
          JSON.stringify({
            type: "hello",
            protocol: PROTOCOL_VERSION,
            extVersion: __EXT_VERSION__,
            userId: this.userId,
          }),
        );
      ws.onmessage = (event) => {
        if (typeof event.data !== "string") return;
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }
        if (!msg || typeof msg !== "object") return;
        if (msg.type === "hello.ack") {
          if (!gradingCapable(msg, this.userId)) {
            clearTimeout(timeout);
            ws.close();
            reject(new Error("Update desktop: local PCM grading is unavailable"));
            return;
          }
          ws.send(
            JSON.stringify({
              type: "pcm.start",
              sessionId: this.sessionId,
              userId: this.userId,
              sampleRate: 16000,
              channels: 1,
              format: "f32le",
              resumeFrom: this.acked,
            }),
          );
        }
        if (msg.type !== "hello.ack" && msg.type !== "error" && msg.sessionId !== this.sessionId)
          return;
        if (msg.type === "pcm.ready") {
          clearTimeout(timeout);
          if (
            typeof msg.nextSample !== "number" ||
            !Number.isSafeInteger(msg.nextSample) ||
            msg.nextSample < this.acked ||
            msg.nextSample > this.total
          ) {
            this.fail("Desktop lost its transcript buffer. Interview is now ungraded.");
            reject(new Error("Cannot resume PCM"));
            return;
          }
          this.ready = true;
          for (const chunk of this.chunks) {
            const skip = Math.max(0, msg.nextSample - chunk.start);
            if (skip < chunk.data.length) ws.send(chunk.data.slice(skip).buffer);
          }
          this.report("Local Whisper connected");
          if (this.ended) this.sendEnd();
          resolve();
        } else if (
          msg.type === "pcm.ack" &&
          typeof msg.nextSample === "number" &&
          Number.isSafeInteger(msg.nextSample) &&
          msg.nextSample >= this.acked &&
          msg.nextSample <= this.total
        ) {
          this.acked = msg.nextSample;
          this.chunks = this.chunks.filter((c) => c.start + c.data.length > this.acked);
        } else if (msg.type === "pcm.complete" && this.ended) {
          this.complete = true;
        } else if (msg.type === "transcript.partial") {
          this.report("Transcribing locally", false, String(msg.text));
        } else if (msg.type === "error") {
          clearTimeout(timeout);
          this.fail(String(msg.message));
          reject(new Error(String(msg.message)));
        }
      };
      ws.onerror = () => {
        clearTimeout(timeout);
        reject(new Error("Desktop unavailable"));
      };
      ws.onclose = () => {
        clearTimeout(timeout);
        this.ready = false;
        reject(new Error("Desktop disconnected"));
        if (!this.failed && !this.complete) {
          this.report("Desktop disconnected. Buffering microphone and retrying; video continues.");
          this.timer = setTimeout(() => void this.connect().catch(() => undefined), 2000);
        }
      };
    });
  }
  push(data: Float32Array) {
    if (this.failed || this.ended) return;
    if (this.total - this.acked + data.length > 16000 * 300) {
      this.fail("Desktop unavailable for 5 minutes. Interview is now ungraded; video continues.");
      return;
    }
    this.chunks.push({ start: this.total, data });
    this.total += data.length;
    if (this.ready && this.ws?.readyState === WebSocket.OPEN) {
      if (this.ws.bufferedAmount > 8 * 1024 * 1024) this.ws.close();
      else this.ws.send(data.buffer as ArrayBuffer);
    }
  }
  pause(paused: boolean) {
    if (this.ready)
      this.ws?.send(
        JSON.stringify({ type: paused ? "pcm.pause" : "pcm.resume", sessionId: this.sessionId }),
      );
  }
  private sendEnd() {
    this.ws?.send(
      JSON.stringify({ type: "pcm.end", sessionId: this.sessionId, totalSamples: this.total }),
    );
  }
  async stop(): Promise<boolean> {
    this.ended = true;
    if (this.ready) this.sendEnd();
    const deadline = Date.now() + 45000;
    while (!this.complete && !this.failed && Date.now() < deadline)
      await new Promise((r) => setTimeout(r, 100));
    if (!this.complete && !this.failed)
      this.fail("Desktop did not finish transcription. Saved as ungraded, without AI review.");
    const success = this.complete && !this.failed;
    this.close();
    return success;
  }
  private fail(message: string) {
    this.failed = true;
    this.report(message, true);
    this.close();
  }
  close() {
    this.failed = true;
    clearTimeout(this.timer);
    this.ws?.close();
    this.chunks = [];
  }
}
