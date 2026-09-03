import {
  type AppToExt,
  decodeAppToExt,
  type ExtToApp,
  encode,
  PROTOCOL_VERSION,
  WS_URL,
} from "@lare/shared";

type HelloAck = Extract<AppToExt, { type: "hello.ack" }>;
type Listener = (msg: AppToExt) => void;

/**
 * WebSocket client to the desktop app. The service worker stays alive while
 * messages flow (Chrome >= 116), so we ping every 20s during interviews.
 */
export class DesktopClient {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private helloAck: HelloAck | null = null;

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN && this.helloAck !== null;
  }

  get ack(): HelloAck | null {
    return this.helloAck;
  }

  onMessage(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Connect and complete the hello handshake, or throw within `timeoutMs`. */
  async connect(userId: string | null, timeoutMs = 1500): Promise<HelloAck> {
    if (this.connected && this.helloAck) return this.helloAck;
    this.close();
    const ws = new WebSocket(WS_URL);
    this.ws = ws;
    const ack = await new Promise<HelloAck>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        ws.close();
        reject(new Error("Lare desktop app is not running"));
      }, timeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        ws.removeEventListener("message", onMessage);
        ws.removeEventListener("error", onError);
        ws.removeEventListener("close", onError);
      };
      const onMessage = (ev: MessageEvent) => {
        const msg = decodeAppToExt(String(ev.data));
        if (msg?.type === "hello.ack") {
          cleanup();
          resolve(msg);
        } else if (msg?.type === "error") {
          cleanup();
          reject(new Error(msg.message));
        }
      };
      const onError = () => {
        cleanup();
        reject(new Error("Lare desktop app is not running"));
      };
      ws.addEventListener("message", onMessage);
      ws.addEventListener("error", onError);
      ws.addEventListener("close", onError);
      ws.addEventListener("open", () => {
        ws.send(
          encode({
            type: "hello",
            protocol: PROTOCOL_VERSION,
            extVersion: __EXT_VERSION__,
            userId,
          }),
        );
      });
    });
    if (ack.protocol !== PROTOCOL_VERSION) {
      ws.close();
      throw new Error(
        `Lare desktop app uses protocol v${ack.protocol}; update the extension or app`,
      );
    }
    this.helloAck = ack;
    ws.addEventListener("message", (ev) => {
      const msg = decodeAppToExt(String(ev.data));
      if (msg) for (const l of this.listeners) l(msg);
    });
    ws.addEventListener("close", () => {
      if (this.ws === ws) {
        this.ws = null;
        this.helloAck = null;
        this.stopPing();
      }
    });
    this.startPing();
    return ack;
  }

  send(msg: ExtToApp): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(encode(msg));
    return true;
  }

  /** Wait for a message satisfying `predicate` (or reject on error / timeout). */
  waitFor<T extends AppToExt>(
    predicate: (msg: AppToExt) => msg is T,
    timeoutMs: number,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        off();
        reject(new Error("Timed out waiting for the desktop app"));
      }, timeoutMs);
      const off = this.onMessage((msg) => {
        if (predicate(msg)) {
          clearTimeout(timer);
          off();
          resolve(msg);
        } else if (msg.type === "error") {
          clearTimeout(timer);
          off();
          reject(new Error(msg.message));
        }
      });
    });
  }

  close(): void {
    this.stopPing();
    const ws = this.ws;
    this.ws = null;
    this.helloAck = null;
    try {
      ws?.close();
    } catch {
      // ignore
    }
  }

  private startPing() {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      this.send({ type: "ping", at: Date.now() });
    }, 20_000);
  }

  private stopPing() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }
}
