/**
 * Keeps a live interview and the desktop recorder in step: reacts to the frames the app sends,
 * catches up after a reconnect, and keeps reconnecting while an interview needs the app.
 */
import { type AppToExt, timerStatus } from "@lare/shared";
import { desktop, probeDesktop, sendQueuedFrames } from "./desktopLink";
import { discardSession, endSession, isFinishing, isStarting, pauseOrResume } from "./interview";
import { broadcast, setRecording } from "./snapshot";
import { loadState } from "./storage";
import { currentUserId } from "./supabase";
import type { HelloAck } from "./ws";

/** Delays between reconnect attempts while a live interview has lost the desktop app. */
const RECONNECT_DELAYS_MS = [1000, 3000, 10_000, 30_000];

/**
 * Catch up after a (re)connect, from the recorder state in `hello.ack`: deliver frames that could
 * not be sent, and bring a live interview in line with what is really being recorded.
 */
async function syncFromAck(ack: HelloAck): Promise<void> {
  const live = ack.recording ?? null;
  await sendQueuedFrames(ack);
  const { interview } = await loadState();
  if (!interview || isStarting() || isFinishing()) return;
  if (timerStatus(interview.events) === "ended") return;
  // Every app that negotiates sends `recording`, null included; absent means it cannot say.
  if (ack.recording === undefined) return;
  if (live?.sessionId === interview.sessionId) {
    // Exactly what the frames themselves would have done, had they arrived.
    await onDesktopMessage({
      type: "recording.state",
      sessionId: live.sessionId,
      state: live.state,
      startedAt: live.startedAt,
      message: null,
    });
    return;
  }
  // Probably restarted mid-interview. Say so rather than guess: ending keeps what was captured,
  // discarding throws it away, and only the user knows which they want.
  await setRecording(
    "error",
    "The desktop app is not recording this interview. End it to save what was captured, or discard it.",
  );
}

let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
/** Keep trying to get the desktop app back while an interview is live. */
export function scheduleReconnect(attempt = 0): void {
  if (reconnectTimer) return;
  const delay = RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)];
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void reconnectIfLive()
      .then((retry) => {
        if (retry) scheduleReconnect(attempt + 1);
      })
      .catch(console.warn);
  }, delay);
}

/** Reconnect if a live interview has lost the desktop app. Resolves true if it is still lost. */
export async function reconnectIfLive(): Promise<boolean> {
  if (desktop.connected) return false;
  const { interview } = await loadState();
  if (!interview || timerStatus(interview.events) === "ended" || isStarting()) return false;
  await probeDesktop(await currentUserId());
  await broadcast();
  return !desktop.connected;
}

export async function onDesktopMessage(msg: AppToExt): Promise<void> {
  if (msg.type === "hello.ack") {
    await syncFromAck(msg);
    return broadcast();
  }
  if (msg.type !== "recording.state") return;
  const { interview } = await loadState();
  if (!interview || msg.sessionId !== interview.sessionId || isStarting()) return;
  if (msg.state === "error") {
    const text = msg.message ?? "The desktop app stopped recording";
    await setRecording("error", text);
    await broadcast({ kind: "error", text });
    return;
  }
  if (msg.state === "recording" || msg.state === "paused" || msg.state === "stopping")
    await setRecording(msg.state, msg.message);
  // The desktop pill can finish an interview on its own. Once the side panel has ended it there is
  // nothing to do: the end or discard is in flight, or the session already carries its end event
  // (a save that failed and waits to be retried).
  if (isFinishing() || timerStatus(interview.events) === "ended") return;
  // Pause and resume from the pill: the recording already did it, so the timer follows. A frame
  // that only echoes the side panel's own pause or resume finds the timer there already.
  const status = timerStatus(interview.events);
  if (msg.state === "paused" && status === "running") await pauseOrResume("pause", true);
  else if (msg.state === "recording" && status === "paused") await pauseOrResume("resume", true);
  // End: stop comes first, so save the session exactly as the side panel's End button would. The
  // `session.end` that sends is answered from the recorder's last result, not stopped twice.
  if (msg.state === "stopping") void endSession();
  // Discard: the recording went straight to idle, with no stop before it.
  else if (msg.state === "idle") await discardSession(interview);
}
