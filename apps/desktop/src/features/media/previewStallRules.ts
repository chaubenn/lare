/**
 * When a local preview has stopped playing without saying so. Pure so it can be unit tested;
 * see `components/LocalPreview.tsx` for the element it watches.
 *
 * A media element only reports what it knows went wrong. A pipeline that is simply never fed
 * reports nothing at all: `paused` stays false, the poster frame stays up, and the clock stays
 * where it was. That is indistinguishable from a healthy paused video unless the clock is
 * sampled, which is what this does.
 *
 * There are two shapes of "never fed", and the element looks different in each. A player that
 * was handed the file and then lost the pipeline sits at `readyState` 4 with a frozen clock. One
 * whose request never came back — the preview server gone, the local copy swept away underneath
 * it — sits at `readyState` 0 or 1 with nothing buffered and a clock that has never left zero.
 * Both are watched, because both leave the caption underneath promising a cloud copy is coming.
 */

/** The slice of `HTMLMediaElement` the rule reads. */
export interface PlaybackSample {
  paused: boolean;
  ended: boolean;
  /** `HAVE_CURRENT_DATA` (2) and up mean the element has something it could be showing. */
  readyState: number;
  currentTime: number;
  /** End of the last buffered range: how much of the file the element has actually been handed. */
  buffered?: number;
}

/** The last time the element was seen to make progress, and when that was. */
export interface StallWatch {
  at: number;
  time: number;
  /** Buffered end at that moment — the only progress a player with nothing to show can make. */
  loaded: number;
  readyState: number;
}

export interface StallVerdict {
  watch: StallWatch | null;
  /** Set once nothing has moved for the grace period while playback was meant to be running. */
  problem: string | null;
}

/** Grace for an element that has data: it should be spending it. */
export const STALL_MS = 4000;
/**
 * Grace for an element that has none yet. Longer, because opening a file and decoding the first
 * frame is legitimately not instant — but this is a local file over loopback, so a spell this
 * long with nothing buffered and no change of `readyState` is not slowness.
 */
export const LOADING_MS = 10_000;

/**
 * Advance the watch by one sample. `problem` is only ever set for a video that believes it is
 * playing — pausing and ending reset the watch instead — and only once it has stopped making any
 * kind of progress: the clock for a player that has data, what it has buffered for one that does
 * not. Ordinary buffering moves one or the other, so ordinary use never trips it.
 */
export function watchPlayback(
  sample: PlaybackSample,
  previous: StallWatch | null,
  now: number,
  stallMs: number = STALL_MS,
  loadingMs: number = LOADING_MS,
): StallVerdict {
  if (sample.paused || sample.ended) {
    return { watch: null, problem: null };
  }
  const loaded = sample.buffered ?? 0;
  const moved =
    !previous ||
    previous.time !== sample.currentTime ||
    previous.loaded !== loaded ||
    previous.readyState !== sample.readyState;
  if (moved) {
    return {
      watch: { at: now, time: sample.currentTime, loaded, readyState: sample.readyState },
      problem: null,
    };
  }
  if (now - previous.at < (sample.readyState < 2 ? loadingMs : stallMs)) {
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
