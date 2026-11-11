import {
  type AppToExt,
  decodeAppToExt,
  type ExtToApp,
  encode,
  MIN_DESKTOP_PROTOCOL_VERSION,
  PROTOCOL_VERSION,
  pairingTranscript,
  WS_URL,
} from "@lare/shared";

export type HelloAck = Extract<AppToExt, { type: "hello.ack" }>;
type Challenge = Extract<AppToExt, { type: "auth.challenge" }>;
type Listener = (msg: AppToExt) => void;

/**
 * The pairing secret (hex) desktop install `installId` published for `userId`, or null when it
 * has published none. `fresh` skips any cached copy. Throws when it cannot be looked up.
 */
export type PairingSecrets = (
  userId: string,
  installId: string,
  fresh: boolean,
) => Promise<string | null>;

const NOT_RUNNING = "Lare desktop app is not running";
/** The secret lookup goes to Supabase; the app waits 20s for the answer, so stay well inside it. */
const SECRET_TIMEOUT_MS = 10_000;

/** Which side has to be updated before the two can work together. */
type Incompatible = "desktop" | "extension";

/** A handshake that got an answer, but not one this extension can work with. */
class RefusedError extends Error {}

class IncompatibleError extends RefusedError {
  constructor(readonly side: Incompatible) {
    super(
      side === "desktop"
        ? "Update the Lare desktop app to record a mock interview."
        : "Update the Lare extension to record a mock interview.",
    );
  }
}

/** Whatever answered could not prove it holds this account's pairing secret, or would not accept ours. */
const UNVERIFIED =
  "Couldn’t verify the Lare desktop app. Quit and reopen it, signed in to this account, then try again.";

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

function refusalFrom(msg: Extract<AppToExt, { type: "error" }>): Error {
  switch (msg.code) {
    case "unsupported_protocol":
      return new IncompatibleError(incompatibleFrom(msg.message));
    case "not_signed_in":
      return new RefusedError("Sign in to the Lare desktop app.");
    case "user_mismatch":
      return new RefusedError("The desktop app is signed in to a different account.");
    case "auth_failed":
      return new RefusedError(UNVERIFIED);
    default:
      return new Error(msg.message);
  }
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array<ArrayBuffer> | null {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/.test(hex)) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++)
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function pairingKey(secretHex: string): Promise<CryptoKey> | null {
  const raw = fromHex(secretHex);
  if (raw?.length !== 32) return null;
  return crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

/** Frames from `ws` in arrival order, for the handshake (which reads them one at a time). */
function frameReader(ws: WebSocket) {
  const queue: AppToExt[] = [];
  let gone = false;
  let waiting: ((msg: AppToExt | null) => void) | null = null;
  const onMessage = (ev: MessageEvent) => {
    const msg = decodeAppToExt(String(ev.data));
    if (!msg) return;
    if (waiting) waiting(msg);
    else queue.push(msg);
  };
  const onGone = () => {
    gone = true;
    waiting?.(null);
  };
  ws.addEventListener("message", onMessage);
  ws.addEventListener("error", onGone);
  ws.addEventListener("close", onGone);
  return {
    next(timeoutMs: number): Promise<AppToExt> {
      const queued = queue.shift();
      if (queued) return Promise.resolve(queued);
      if (gone) return Promise.reject(new Error(NOT_RUNNING));
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          waiting = null;
          reject(new Error(NOT_RUNNING));
        }, timeoutMs);
        waiting = (msg) => {
          clearTimeout(timer);
          waiting = null;
          if (msg) resolve(msg);
          else reject(new Error(NOT_RUNNING));
        };
      });
    },
    stop() {
      ws.removeEventListener("message", onMessage);
      ws.removeEventListener("error", onGone);
      ws.removeEventListener("close", onGone);
    },
  };
}

function opened(ws: WebSocket, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => done(new Error(NOT_RUNNING)), timeoutMs);
    const done = (err?: Error) => {
      clearTimeout(timer);
      ws.removeEventListener("open", onOpen);
      ws.removeEventListener("error", onFail);
      ws.removeEventListener("close", onFail);
      if (err) reject(err);
      else resolve();
    };
    const onOpen = () => done();
    const onFail = () => done(new Error(NOT_RUNNING));
    ws.addEventListener("open", onOpen);
    ws.addEventListener("error", onFail);
    ws.addEventListener("close", onFail);
  });
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new RefusedError(message)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/**
 * WebSocket client to the desktop app. The service worker stays alive while
 * messages flow (Chrome >= 116), so we ping every 20s during interviews.
 *
 * Nothing is trusted until the app has proved it holds this account's pairing secret for its
 * install (and accepted our proof in turn); see `ws_server.rs` in the desktop app.
 */
export class DesktopClient {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private closeListeners = new Set<() => void>();
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private helloAck: HelloAck | null = null;
  private connecting: Promise<HelloAck> | null = null;
  /**
   * Why the last handshake failed, when something answered: an app this extension cannot work
   * with (or the other way round), signed out or into another account, or not verifiable.
   * Outlives the socket, so the side panel keeps saying so rather than "open the app" until a
   * handshake succeeds or the app stops answering.
   */
  private refusal: string | null = null;

  constructor(private readonly secrets: PairingSecrets) {}

  /** The desktop app can record a mock interview for `userId` right now. */
  recordingAvailable(userId: string | null): boolean {
    return this.blocker(userId) === null;
  }

  /** Why a mock interview cannot start, in words the side panel can show, or null when it can. */
  blocker(userId: string | null): string | null {
    if (!userId) return "Sign in to Lare to record a mock interview.";
    if (this.refusal) return this.refusal;
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

  /** Connect and complete the handshake, or throw. Each wait on the socket gets `timeoutMs`. */
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
    // Pairing is per account: there is nothing to prove without one.
    if (!userId) throw new Error("Sign in to Lare first");
    const ws = new WebSocket(WS_URL);
    this.ws = ws;
    const ack = await this.handshake(ws, userId, timeoutMs).catch((e: unknown) => {
      if (this.ws === ws) this.ws = null;
      ws.close();
      // An app that is not answering says nothing about versions or accounts; "open the app" is
      // right again.
      this.refusal = e instanceof RefusedError ? e.message : null;
      throw e;
    });
    this.refusal = null;
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

  private async handshake(ws: WebSocket, userId: string, timeoutMs: number): Promise<HelloAck> {
    const frames = frameReader(ws);
    try {
      await opened(ws, timeoutMs);
      const extNonce = toHex(crypto.getRandomValues(new Uint8Array(32)));
      ws.send(
        encode({
          type: "hello",
          protocol: PROTOCOL_VERSION,
          extVersion: __EXT_VERSION__,
          userId,
          nonce: extNonce,
        }),
      );
      const first = await frames.next(timeoutMs);
      if (first.type === "error") throw refusalFrom(first);
      if (first.type === "hello.ack") {
        // Only an app from before pairing answers hello straight away. Anything claiming to be
        // newer and skipping the challenge is not the app.
        if ((first.protocol ?? 0) < MIN_DESKTOP_PROTOCOL_VERSION)
          throw new IncompatibleError("desktop");
        throw new RefusedError(UNVERIFIED);
      }
      if (first.type !== "auth.challenge") throw new RefusedError(UNVERIFIED);

      const key = await this.verifiedKey(userId, extNonce, first);
      const ours = pairingTranscript("ext", userId, extNonce, first.nonce);
      const proof = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(ours));
      ws.send(encode({ type: "auth.response", proof: toHex(new Uint8Array(proof)) }));

      const ack = await frames.next(timeoutMs);
      if (ack.type === "error") throw refusalFrom(ack);
      if (ack.type !== "hello.ack") throw new RefusedError(UNVERIFIED);
      return ack;
    } finally {
      frames.stop();
    }
  }

  /**
   * The pairing key, once the app's proof checks out against it. A cached secret that fails is
   * looked up again before giving up: the app replaces its secret every time it signs out.
   */
  private async verifiedKey(
    userId: string,
    extNonce: string,
    challenge: Challenge,
  ): Promise<CryptoKey> {
    const theirs = new TextEncoder().encode(
      pairingTranscript("app", userId, extNonce, challenge.nonce),
    );
    const proof = fromHex(challenge.proof);
    if (!proof || !fromHex(challenge.nonce)) throw new RefusedError(UNVERIFIED);
    for (const fresh of [false, true]) {
      const secret = await withTimeout(
        this.secrets(userId, challenge.installId, fresh).catch((e: unknown) => {
          console.warn("[lare] pairing secret lookup failed", e);
          throw new RefusedError(
            "Couldn’t reach Lare to check the desktop app. Check your internet connection and try again.",
          );
        }),
        SECRET_TIMEOUT_MS,
        "Couldn’t reach Lare to check the desktop app. Check your internet connection and try again.",
      );
      if (secret === null) {
        if (!fresh) continue;
        throw new RefusedError(
          "The Lare desktop app hasn’t paired with this account yet. Open it while online and signed in, then try again.",
        );
      }
      const key = await pairingKey(secret);
      if (key && (await crypto.subtle.verify("HMAC", key, proof, theirs))) return key;
    }
    throw new RefusedError(UNVERIFIED);
  }

  send(msg: ExtToApp): boolean {
    if (!this.connected || !this.ws) return false;
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
