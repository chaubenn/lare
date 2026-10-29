/**
 * When a local preview has stopped playing without saying so. Pure so it can be unit tested;
 * see `components/LocalPreview.tsx` for the element it watches.
 *
 * A media element only reports what it knows went wrong. A pipeline that is simply never fed
 * reports nothing at all: `paused` stays false, the poster frame stays up, and the clock stays
 * where it was. That is indistinguishable from a healthy paused video unless the clock is
 * sampled, which is what this does.
 */

/** The slice of `HTMLMediaElement` the rule reads. */
export interface PlaybackSample {
  paused: boolean;
  ended: boolean;
  /** `HAVE_CURRENT_DATA` (2) and up mean the element has something it could be showing. */
  readyState: number;
  currentTime: number;
}

/** The last time the clock was seen to move, and when that was. */
export interface StallWatch {
  at: number;
  time: number;
}

export interface StallVerdict {
  watch: StallWatch | null;
  /** Set once the clock has been still for `stallMs` while playback was meant to be running. */
  problem: string | null;
}

export const STALL_MS = 4000;

/**
 * Advance the watch by one sample. `problem` is only ever set for a video that believes it is
 * playing — buffering (`readyState < 2`), pausing and ending all reset the watch instead, so
 * ordinary use never trips it.
 */
export function watchPlayback(
  sample: PlaybackSample,
  previous: StallWatch | null,
  now: number,
  stallMs: number = STALL_MS,
): StallVerdict {
  if (sample.paused || sample.ended || sample.readyState < 2) {
    return { watch: null, problem: null };
  }
  if (!previous || previous.time !== sample.currentTime) {
    return { watch: { at: now, time: sample.currentTime }, problem: null };
  }
  if (now - previous.at < stallMs) {
    return { watch: previous, problem: null };
  }
  return {
    watch: previous,
    // Never having started is worth saying differently: the recording is on this device and the
    // player was handed it, so "stalled" would point at the network when nothing was sent.
    problem:
      sample.currentTime === 0
        ? "Playback never started. The recording is on this device, but the player is not being fed."
        : "Playback stalled.",
  };
}

/** What the four `MediaError` codes mean for a file we are serving to ourselves over loopback. */
export function mediaErrorText(code: number | undefined): string {
  switch (code) {
    case 1:
      return "Playback was aborted.";
    case 2:
      return "The preview server stopped responding.";
    case 3:
      return "This device could not decode the recording.";
    case 4:
      return "The recording could not be opened.";
    default:
      return "Playback failed.";
  }
}
