/**
 * The connection to the Lare desktop app: the one socket client, the pairing secrets it proves
 * itself with, and the `session.end`/`session.cancel` frames that must reach the app even when it
 * is not connected at the time. Knows nothing about what an interview does with the connection.
 */
import type { ExtToApp } from "@lare/shared";
import {
  clearDesktopFrame,
  hasDesktopOutbox,
  type OutboxFrame,
  queueDesktopFrame,
  takeDesktopOutbox,
} from "./queues";
import { loadState, secureStorage } from "./storage";
import { currentUserId, getSupabase } from "./supabase";
import { DesktopClient, type HelloAck } from "./ws";

/**
 * Cached desktop pairing secrets, `${PAIRING_PREFIX}${userId}:${installId}`. They share
 * `secureStorage`'s flat keyspace with supabase-js's session key (`sb-<project>-auth-token`), so
 * the prefix must never match that.
 */
const PAIRING_PREFIX = "lare:pairing:";

/**
 * The secret a desktop install published for this account (migration 0032), cached so an
 * interview can reconnect without a network. Row-level security only shows the caller's own
 * rows, so an app signed in to another account has none to find.
 */
async function pairingSecret(
  userId: string,
  installId: string,
  fresh: boolean,
): Promise<string | null> {
  const key = `${PAIRING_PREFIX}${userId}:${installId}`;
  if (!fresh) {
    const cached = await secureStorage.get(key);
    if (cached) return cached;
  }
  const { data, error } = await getSupabase()
    .from("bridge_secrets")
    .select("secret")
    .eq("user_id", userId)
    .eq("install_id", installId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (data) await secureStorage.set(key, data.secret);
  else await secureStorage.remove(key);
  return data?.secret ?? null;
}

export const desktop = new DesktopClient(pairingSecret);

/** Drop every cached pairing secret (sign-out). */
export function forgetPairingSecrets(): Promise<void> {
  return secureStorage.removePrefix(PAIRING_PREFIX);
}

/** Connect if need be. Resolves whether the app can record a mock interview for `userId`. */
export async function probeDesktop(userId: string | null): Promise<boolean> {
  try {
    // What the app can do is fixed at handshake time, so a connection made before it signed in or
    // was allowed to record would say "unavailable" forever. Handshake again instead.
    if (desktop.connected && !desktop.recordingAvailable(userId) && !(await loadState()).interview)
      desktop.close();
    await desktop.connect(userId);
    return desktop.recordingAvailable(userId);
  } catch {
    return false;
  }
}

function sessionFrame(frame: OutboxFrame, sessionId: string, at: number): ExtToApp {
  return { type: frame === "end" ? "session.end" : "session.cancel", sessionId, at };
}

/**
 * Send `session.end`/`session.cancel` now, or keep it until the desktop app is back: a recording
 * nobody tells to stop runs on, and a cancelled start would still record and upload.
 */
export async function tellDesktop(
  frame: OutboxFrame,
  sessionId: string,
  at = Date.now(),
): Promise<void> {
  const sent = desktop.send(sessionFrame(frame, sessionId, at));
  if (sent) await clearDesktopFrame(sessionId);
  else await queueDesktopFrame(sessionId, frame);
}

/** Connect to the desktop app if frames are waiting for it (the handshake delivers them). */
export async function deliverOutbox(): Promise<void> {
  if (desktop.connected || !(await hasDesktopOutbox())) return;
  await probeDesktop(await currentUserId());
}

/** After a (re)connect: send the frames that could not be sent while the app was away. */
export async function sendQueuedFrames(ack: HelloAck): Promise<void> {
  const live = ack.recording ?? null;
  const outbox = await takeDesktopOutbox();
  for (const [sessionId, frame] of Object.entries(outbox)) {
    // Only a recording still running for that session needs telling; otherwise it is moot.
    if (live?.sessionId === sessionId) desktop.send(sessionFrame(frame, sessionId, Date.now()));
  }
}
