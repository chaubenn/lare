import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import {
  __resetNoticesForTest,
  clearNotices,
  dismissNotice,
  markNoticesRead,
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
  assert.equal(newest.readAt, null);
  assert.equal(oldest.title, "First");
  // Defaults, so a caller only has to pass a title.
  assert.equal(oldest.tone, "info");
  assert.equal(oldest.description, null);
  assert.equal(oldest.href, null);
});

test("a keyed notice replaces its predecessor instead of stacking", () => {
  notify({ key: "permission:microphone", title: "Microphone is blocked" });
  notify({ key: "permission:microphone", title: "Microphone is blocked" });
  notify({ key: "permission:microphone", title: "Microphone is blocked" });
  assert.equal(noticesSnapshot().length, 1, "a poll that keeps failing is still one problem");
});

test("different keys are different notices", () => {
  notify({ key: "permission:microphone", title: "Microphone is blocked" });
  notify({ key: "permission:camera", title: "Camera is blocked" });
  assert.equal(noticesSnapshot().length, 2);
});

test("an unkeyed notice is always new", () => {
  notify({ title: "Upload finished" });
  notify({ title: "Upload finished" });
  assert.equal(noticesSnapshot().length, 2, "two uploads finishing are two events, not one");
});

test("a keyed repeat moves back to the top and is unread again", () => {
  notify({ key: "update:1.0.0", title: "Update" });
  notify({ title: "Something else" });
  markNoticesRead();
  assert.ok(noticesSnapshot().every((n) => n.readAt !== null));

  notify({ key: "update:1.0.0", title: "Update" });
  const [newest] = noticesSnapshot();
  assert.equal(newest.title, "Update");
  assert.equal(newest.readAt, null, "a fact that is true again is worth surfacing again");
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

test("marking read leaves the list alone and clearing empties it", () => {
  notify({ title: "One" });
  notify({ title: "Two" });
  markNoticesRead();
  assert.equal(noticesSnapshot().length, 2);
  assert.ok(noticesSnapshot().every((n) => typeof n.readAt === "number"));

  clearNotices();
  assert.equal(noticesSnapshot().length, 0);
});

test("the list is capped so a long session cannot grow without bound", () => {
  for (let i = 0; i < 150; i += 1) notify({ title: `Notice ${i}` });
  assert.equal(noticesSnapshot().length, 100);
  assert.equal(noticesSnapshot()[0].title, "Notice 149", "the newest survive, not the oldest");
});
