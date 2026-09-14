import assert from "node:assert/strict";
import { test } from "node:test";
import { canUseRawVideo } from "../src/features/media/studio/unedited.ts";
import { draftStepError } from "../src/features/publishing/drafts/validation.ts";

const draft = { title: "Demo", body: "", visibility: "public", recording: false, uploading: false };
test("general and text-only drafts may advance without problems or video", () => {
  for (let step = 0; step < 5; step++) assert.equal(draftStepError(step, draft), null);
});
test("media blocks active capture and pending upload, including final review", () => {
  for (const step of [1, 4]) {
    assert.match(draftStepError(step, { ...draft, recording: true }), /Stop/);
    assert.match(draftStepError(step, { ...draft, uploading: true }), /upload/);
  }
});
test("details and extras validate before publication", () => {
  for (const patch of [
    { title: " " },
    { title: "x".repeat(141) },
    { body: "x".repeat(5001) },
    { visibility: "invalid" },
  ]) {
    assert.ok(draftStepError(4, { ...draft, ...patch }));
  }
});
test("only unedited single-track video bypasses render", () => {
  const edit = { segments: [], padding: 0, aspectRatio: null };
  assert.equal(canUseRawVideo(edit, false, false, 1), true);
  for (const [camera, mic, clips] of [
    [true, false, 1],
    [false, true, 1],
    [false, false, 2],
  ]) {
    assert.equal(canUseRawVideo(edit, camera, mic, clips), false);
  }
  for (const patch of [
    { padding: 2 },
    { aspectRatio: "wide" },
    { segments: [{ start: 1, end: 2 }] },
  ]) {
    assert.equal(canUseRawVideo({ ...edit, ...patch }, false, false, 1), false);
  }
});
