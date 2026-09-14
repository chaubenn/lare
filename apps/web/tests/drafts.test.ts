import assert from "node:assert/strict";
import test from "node:test";
import { type DraftEdit, DraftEditSchema, validateDraftStep } from "../lib/drafts.ts";

const edit: DraftEdit = {
  title: "My practice",
  body: "Notes",
  visibility: "private",
  show_video: true,
  show_demo_video: false,
  include_ai_insights: false,
  include_og_card: true,
  og_show_ai_scores: false,
  video_id: null,
  demo_video_id: null,
};

test("general video skips problems but requires media", () => {
  assert.equal(validateDraftStep(0, edit, 0, false), null);
  assert.match(validateDraftStep(1, edit, 0, false) ?? "", /Record or attach/);
  assert.equal(
    validateDraftStep(1, { ...edit, video_id: "00000000-0000-4000-8000-000000000001" }, 0, false),
    null,
  );
});
test("session needs problems, not a mandatory summary", () => {
  assert.match(validateDraftStep(0, edit, 0, true) ?? "", /no captured problems/);
  assert.equal(validateDraftStep(0, edit, 1, true), null);
  assert.equal(validateDraftStep(1, edit, 1, true), null);
});
test("draft may autosave an empty title but cannot advance details", () => {
  assert.equal(DraftEditSchema.safeParse({ ...edit, title: "" }).success, true);
  assert.match(validateDraftStep(2, { ...edit, title: "  " }, 1, true) ?? "", /Add a title/);
});
test("server payload rejects invalid fields and over-limit content", () => {
  for (const patch of [
    { title: "a".repeat(141) },
    { body: "a".repeat(5001) },
    { visibility: "friends" },
    { show_video: "true" },
    { video_id: "not-a-video" },
  ]) {
    assert.equal(DraftEditSchema.safeParse({ ...edit, ...patch }).success, false);
  }
  assert.equal(
    DraftEditSchema.safeParse({ ...edit, title: "a".repeat(140), body: "a".repeat(5000) }).success,
    true,
  );
});
test("full and summary video must be distinct", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  assert.match(
    validateDraftStep(1, { ...edit, video_id: id, demo_video_id: id }, 1, true) ?? "",
    /different video/,
  );
});
