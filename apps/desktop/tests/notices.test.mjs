import assert from "node:assert/strict";
import { test } from "node:test";
import { createNoticeStore } from "../src/lib/noticeStore.ts";

test("a notice keeps what it was told, newest first", () => {
  const { notify, snapshot } = createNoticeStore();
  notify({ title: "First" });
  notify({ title: "Second", description: "detail", variant: "error", href: "/settings" });

  const [newest, oldest] = snapshot();
  assert.equal(newest.title, "Second");
  assert.equal(newest.description, "detail");
  assert.equal(newest.tone, "error");
  assert.equal(newest.href, "/settings");
  assert.equal(oldest.title, "First");
  // Defaults, so a caller only has to pass a title.
  assert.equal(oldest.tone, "info");
  assert.equal(oldest.description, null);
  assert.equal(oldest.href, null);
});

test("a keyed notice replaces its predecessor instead of stacking", () => {
  const { notify, snapshot } = createNoticeStore();
  notify({ key: "permission:microphone", title: "Microphone is blocked" });
  notify({ key: "permission:microphone", title: "Microphone is still blocked" });
  assert.equal(snapshot().length, 1, "a poll that keeps failing is still one problem");
  assert.equal(snapshot()[0].title, "Microphone is still blocked");
});

test("different keys are different notices", () => {
  const { notify, snapshot } = createNoticeStore();
  notify({ key: "permission:microphone", title: "Microphone is blocked" });
  notify({ key: "permission:camera", title: "Camera is blocked" });
  assert.equal(snapshot().length, 2);
});

test("an identical notice on screen is refreshed, not stacked", () => {
  const { notify, snapshot } = createNoticeStore();
  notify({ title: "Wait for the upload", variant: "error" });
  const [first] = snapshot();
  notify({ title: "Something else" });
  notify({ title: "Wait for the upload", variant: "error" });

  assert.equal(snapshot().length, 2, "pressing a button nine times is one toast");
  const [newest] = snapshot();
  assert.equal(newest.id, first.id);
  assert.equal(newest.title, "Wait for the upload");
});

test("the same title with a different outcome is a different notice", () => {
  const { notify, snapshot } = createNoticeStore();
  notify({ title: "Upload", variant: "success" });
  notify({ title: "Upload", variant: "error" });
  assert.equal(snapshot().length, 2);
});

test("dismissing a keyed notice frees the key for a fresh one", () => {
  const { notify, dismiss, snapshot } = createNoticeStore();
  notify({ key: "update:1.0.0", title: "Update" });
  const [first] = snapshot();
  dismiss(first.id);
  assert.equal(snapshot().length, 0);

  notify({ key: "update:1.0.0", title: "Update" });
  assert.equal(snapshot().length, 1, "a dismissed notice must be able to come back");
});

test("only a few toasts show at once, and the newest win", () => {
  const { notify, snapshot } = createNoticeStore();
  for (let i = 0; i < 10; i += 1) notify({ title: `Notice ${i}` });
  assert.equal(snapshot().length, 4);
  assert.equal(snapshot()[0].title, "Notice 9");
});

test("a keyed notice pushed off screen can come back", () => {
  const { notify, snapshot } = createNoticeStore();
  notify({ key: "k", title: "Keyed" });
  for (let i = 0; i < 4; i += 1) notify({ title: `Notice ${i}` });
  assert.ok(!snapshot().some((n) => n.title === "Keyed"));

  notify({ key: "k", title: "Keyed" });
  assert.equal(snapshot()[0].title, "Keyed");
});
