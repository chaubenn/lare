import assert from "node:assert/strict";
import { test } from "node:test";
import { DRAFT_STEP, draftStepError } from "../src/features/publishing/drafts/validation.ts";

const draft = { title: "Demo", body: "", visibility: "public", recording: false, uploading: false };
const { problems, media, details, extras, publish } = DRAFT_STEP;

test("general and text-only drafts may advance without problems or video", () => {
  for (const step of [problems, media, details, extras, publish])
    assert.equal(draftStepError(step, draft), null);
});

test("an active capture blocks the media step and every step after it", () => {
  const recording = { ...draft, recording: true };
  assert.equal(draftStepError(problems, recording), null);
  for (const step of [media, details, extras, publish])
    assert.equal(draftStepError(step, recording), "Stop the recording before continuing.");
});

test("an upload in progress only blocks publishing", () => {
  const uploading = { ...draft, uploading: true };
  for (const step of [media, details, extras]) assert.equal(draftStepError(step, uploading), null);
  assert.equal(
    draftStepError(publish, uploading),
    "Wait for the video upload to finish before publishing.",
  );
});

test("the title and body are checked from the details step on", () => {
  const message = "Add a title of 1-140 characters and keep the body under 5,000 characters.";
  for (const patch of [{ title: " " }, { title: "x".repeat(141) }, { body: "x".repeat(5001) }]) {
    assert.equal(draftStepError(media, { ...draft, ...patch }), null);
    assert.equal(draftStepError(details, { ...draft, ...patch }), message);
    assert.equal(draftStepError(publish, { ...draft, ...patch }), message);
  }
  assert.equal(
    draftStepError(publish, { ...draft, title: "x".repeat(140), body: "x".repeat(5000) }),
    null,
  );
});

test("the visibility is checked from the extras step on", () => {
  const invalid = { ...draft, visibility: "invalid" };
  assert.equal(draftStepError(details, invalid), null);
  assert.equal(draftStepError(extras, invalid), "Choose a valid visibility.");
});
