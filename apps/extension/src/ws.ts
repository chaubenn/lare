import {
  type AppToExt,
  decodeAppToExt,
  type ExtToApp,
  encode,
  MIN_DESKTOP_PROTOCOL_VERSION,
  PROTOCOL_VERSION,
  WS_URL,
} from "@lare/shared";

export type HelloAck = Extract<AppToExt, { type: "hello.ack" }>;
type Listener = (msg: AppToExt) => void;

/** Which side has to be updated before the two can work together. */
type Incompatible = "desktop" | "extension";

class IncompatibleError extends Error {
  constructor(readonly side: Incompatible) {
    super(
      side === "desktop"
        ? "Update the Lare desktop app to record a mock interview."
        : "Update the Lare extension to record a mock interview.",
    );
  }
}

/**
 * Who is out of date, from an `unsupported_protocol` refusal. Every app words it "desktop app
 * speaks protocol vN" (v2 apps refuse any version but their own; later ones only refuse an
 * extension older than they still serve).
 */
function incompatibleFrom(message: string): Incompatible {
  const desktop = Number(/speaks protocol v(\d+)/.exec(message)?.[1] ?? Number.NaN);
  return Number.isFinite(desktop) && desktop >= MIN_DESKTOP_PROTOCOL_VERSION
    ? "extension"
    : "desktop";
}

/**
 * WebSocket client to the desktop app. The service worker stays alive while
 * messages flow (Chrome >= 116), so we ping every 20s during interviews.
 */
export class DesktopClient {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private closeListeners = new Set<() => void>();
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private helloAck: HelloAck | null = null;
  private connecting: Promise<HelloAck> | null = null;
  /**
   * Set when the last handshake found an app this extension cannot run interviews against (or
   * the other way round). Outlives the socket, so the side panel keeps saying "update" rather
   * than "open" until a handshake succeeds or the app stops answering.
   */
  private incompatible: Incompatible | null = null;

  /** The desktop app can record a mock interview for `userId` right now. */
  recordingAvailable(userId: string | null): boolean {
    return this.blocker(userId) === null;
  }

  /** Why a mock interview cannot start, in words the side panel can show, or null when it can. */
  blocker(userId: string | null): string | null {
    if (this.incompatible) return new IncompatibleError(this.incompatible).message;
    const ack = this.connected ? this.helloAck : null;
    if (!ack) return "Open the Lare desktop app to record a mock interview.";
    if (!ack.userId) return "Sign in to the Lare desktop app.";
    if (ack.userId !== userId) return "The desktop app is signed in to a different account.";
    if (!ack.recordingCapable)
      return "Allow screen recording for Lare in the desktop app (Settings → Recording).";
    return null;
  }

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

  onClose(listener: () => void): () => void {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  /** Connect and complete the hello handshake, or throw within `timeoutMs`. */
  async connect(userId: string | null, timeoutMs = 3000): Promise<HelloAck> {
    if (this.connected && this.helloAck) return this.helloAck;
    if (this.connecting) return this.connecting;
    this.connecting = this.open(userId, timeoutMs).finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  private async open(userId: string | null, timeoutMs: number): Promise<HelloAck> {
    if (this.connected && this.helloAck) return this.helloAck;
    this.close();
    const ws = new WebSocket(WS_URL);
    this.ws = ws;
    const ack = await this.handshake(ws, userId, timeoutMs).catch((e: unknown) => {
      // An app that is not answering says nothing about versions; "open the app" is right again.
      this.incompatible = e instanceof IncompatibleError ? e.side : null;
      throw e;
    });
    // Missing on apps too old to negotiate; lower than we need on a v2 app that understood us.
    if ((ack.protocol ?? 0) < MIN_DESKTOP_PROTOCOL_VERSION) {
      ws.close();
      this.incompatible = "desktop";
      throw new IncompatibleError("desktop");
    }
    this.incompatible = null;
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
        for (const l of this.closeListeners) l();
      }
    });
    this.startPing();
    // Listeners see the handshake's ack too: it carries the recorder's state, which is how the
    // background catches up on frames it missed while disconnected.
    for (const l of this.listeners) l(ack);
    return ack;
  }

  private handshake(ws: WebSocket, userId: string | null, timeoutMs: number): Promise<HelloAck> {
    return new Promise<HelloAck>((resolve, reject) => {
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
          reject(
            msg.code === "unsupported_protocol"
              ? new IncompatibleError(incompatibleFrom(msg.message))
              : new Error(msg.message),
          );
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
  }

  send(msg: ExtToApp): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(encode(msg));
    return true;
  }

  /** Wait for a message satisfying `predicate` (or reject on error / timeout / abort). */
  waitFor<T extends AppToExt>(
    predicate: (msg: AppToExt) => msg is T,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("Timed out waiting for the desktop app"));
      }, timeoutMs);
      const onAbort = () => {
        cleanup();
        reject(new DOMException("Aborted", "AbortError"));
      };
      const off = this.onMessage((msg) => {
        if (predicate(msg)) {
          cleanup();
          resolve(msg);
        } else if (msg.type === "error") {
          cleanup();
          reject(new Error(msg.message));
        }
      });
      const cleanup = () => {
        clearTimeout(timer);
        off();
        signal?.removeEventListener("abort", onAbort);
      };
      signal?.addEventListener("abort", onAbort);
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
