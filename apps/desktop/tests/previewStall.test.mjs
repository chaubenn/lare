import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LOADING_MS,
  mediaErrorText,
  STALL_MS,
  watchPlayback,
} from "../src/features/media/previewStallRules.ts";

const playing = { paused: false, ended: false, readyState: 4, currentTime: 0 };

/** Feed samples a second apart and return the last verdict. */
function run(samples, stallMs = STALL_MS) {
  let watch = null;
  let verdict = { watch: null, problem: null };
  let now = 1_000_000;
  for (const sample of samples) {
    verdict = watchPlayback({ ...playing, ...sample }, watch, now, stallMs);
    watch = verdict.watch;
    now += 1000;
  }
  return verdict;
}

test("a clock that keeps moving is never reported", () => {
  const verdict = run([
    { currentTime: 0 },
    { currentTime: 1 },
    { currentTime: 2 },
    { currentTime: 3 },
    { currentTime: 4 },
    { currentTime: 5 },
  ]);
  assert.equal(verdict.problem, null);
});

test("a video that believes it is playing but never moves is reported", () => {
  const verdict = run(Array(6).fill({ currentTime: 0 }));
  assert.match(verdict.problem, /never started/);
});

test("a stall part-way through is reported as a stall, not as a failure to start", () => {
  const verdict = run([
    { currentTime: 0 },
    { currentTime: 1 },
    ...Array(5).fill({ currentTime: 2 }),
  ]);
  assert.equal(verdict.problem, "Playback stalled.");
});

test("nothing is reported before the grace period is up", () => {
  // Two samples a second apart is one second of stillness; the rule waits STALL_MS.
  assert.equal(run([{ currentTime: 0 }, { currentTime: 0 }]).problem, null);
});

test("pausing and ending reset the watch instead of tripping it", () => {
  for (const quiet of [{ paused: true }, { ended: true }]) {
    const verdict = run([...Array(5).fill({ currentTime: 0 }), quiet]);
    assert.equal(verdict.problem, null, JSON.stringify(quiet));
    assert.equal(verdict.watch, null);
  }
});

test("an element with nothing to play yet gets the longer grace, then is reported", () => {
  // What a preview whose request never came back looks like: trying to play, nothing buffered.
  const loading = { readyState: 0, currentTime: 0, buffered: 0 };
  assert.equal(run(Array(6).fill(loading)).problem, null, "still inside the loading grace");
  assert.match(run(Array(12).fill(loading)).problem, /never started/);
});

test("buffering that is getting somewhere is left alone", () => {
  const verdict = run(
    Array.from({ length: 20 }, (_, i) => ({ readyState: 1, currentTime: 0, buffered: i * 0.5 })),
  );
  assert.equal(verdict.problem, null);
});

test("readyState climbing counts as progress on its own", () => {
  const verdict = run([
    ...Array(8).fill({ readyState: 0, currentTime: 0, buffered: 0 }),
    ...Array(8).fill({ readyState: 1, currentTime: 0, buffered: 0 }),
  ]);
  assert.equal(verdict.problem, null);
  assert.ok(LOADING_MS > STALL_MS, "an element with no data is given longer than one with data");
});

test("a pause long enough to trip the rule does not, because the watch restarts on resume", () => {
  let watch = null;
  let now = 0;
  const step = (sample, ms) => {
    now += ms;
    const verdict = watchPlayback({ ...playing, ...sample }, watch, now);
    watch = verdict.watch;
    return verdict.problem;
  };
  step({ currentTime: 3 }, 1000);
  assert.equal(step({ paused: true, currentTime: 3 }, 60_000), null);
  assert.equal(step({ currentTime: 3 }, 1000), null, "resuming starts a fresh watch");
});

test("each MediaError code says something a user can act on", () => {
  assert.match(mediaErrorText(2), /server/);
  assert.match(mediaErrorText(3), /decode/);
  assert.equal(mediaErrorText(undefined), "Playback failed.");
  assert.equal(mediaErrorText(99), "Playback failed.");
});
