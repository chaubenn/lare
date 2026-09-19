import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import {
  __resetNoticesForTest,
  dismissNotice,
  noticesSnapshot,
  notify,
} from "../src/features/notifications/notices.ts";

// The store is module state shared by every caller, which is the point — anything in the app can
// report without threading a provider through. Tests have to reset it between cases.
beforeEach(() => __resetNoticesForTest());

test("a notice keeps what it was told, newest first", () => {
  notify({ title: "First" });
  notify({ title: "Second", description: "detail", variant: "error", href: "/settings" });

  const [newest, oldest] = noticesSnapshot();
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
  notify({ key: "permission:microphone", title: "Microphone is blocked" });
  notify({ key: "permission:microphone", title: "Microphone is still blocked" });
  assert.equal(noticesSnapshot().length, 1, "a poll that keeps failing is still one problem");
  assert.equal(noticesSnapshot()[0].title, "Microphone is still blocked");
});

test("different keys are different notices", () => {
  notify({ key: "permission:microphone", title: "Microphone is blocked" });
  notify({ key: "permission:camera", title: "Camera is blocked" });
  assert.equal(noticesSnapshot().length, 2);
});

test("an identical notice on screen is refreshed, not stacked", () => {
  notify({ title: "Wait for the upload", variant: "error" });
  const [first] = noticesSnapshot();
  notify({ title: "Something else" });
  notify({ title: "Wait for the upload", variant: "error" });

  assert.equal(noticesSnapshot().length, 2, "pressing a button nine times is one toast");
  const [newest] = noticesSnapshot();
  assert.equal(newest.id, first.id);
  assert.equal(newest.title, "Wait for the upload");
});

test("the same title with a different outcome is a different notice", () => {
  notify({ title: "Upload", variant: "success" });
  notify({ title: "Upload", variant: "error" });
  assert.equal(noticesSnapshot().length, 2);
});

test("dismissing a keyed notice frees the key for a fresh one", () => {
  notify({ key: "update:1.0.0", title: "Update" });
  const [first] = noticesSnapshot();
  dismissNotice(first.id);
  assert.equal(noticesSnapshot().length, 0);

  notify({ key: "update:1.0.0", title: "Update" });
  assert.equal(noticesSnapshot().length, 1, "a dismissed notice must be able to come back");
});

test("only a few toasts show at once, and the newest win", () => {
  for (let i = 0; i < 10; i += 1) notify({ title: `Notice ${i}` });
  assert.equal(noticesSnapshot().length, 4);
  assert.equal(noticesSnapshot()[0].title, "Notice 9");
});

test("a keyed notice pushed off screen can come back", () => {
  notify({ key: "k", title: "Keyed" });
  for (let i = 0; i < 4; i += 1) notify({ title: `Notice ${i}` });
  assert.ok(!noticesSnapshot().some((n) => n.title === "Keyed"));

  notify({ key: "k", title: "Keyed" });
  assert.equal(noticesSnapshot()[0].title, "Keyed");
});
