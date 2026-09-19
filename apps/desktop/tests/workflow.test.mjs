import assert from "node:assert/strict";
import { test } from "node:test";
import { draftStepError } from "../src/features/publishing/drafts/validation.ts";

const draft = { title: "Demo", body: "", visibility: "public", recording: false, uploading: false };
test("general and text-only drafts may advance without problems or video", () => {
  for (let step = 0; step < 5; step++) assert.equal(draftStepError(step, draft), null);
});
test("media blocks active capture on every step after it", () => {
  for (const step of [1, 4])
    assert.match(draftStepError(step, { ...draft, recording: true }), /Stop/);
});
test("an upload in progress only blocks publishing", () => {
  for (const step of [1, 2, 3])
    assert.equal(draftStepError(step, { ...draft, uploading: true }), null);
  assert.match(draftStepError(4, { ...draft, uploading: true }), /upload/);
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
