import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultSubmissionIndex, submissionsInAttemptOrder } from "../src/lib/submissions.ts";

const sub = (id, submittedAt, accepted, runtimeMs = null) => ({
  id,
  submitted_at: new Date(submittedAt).toISOString(),
  accepted,
  runtime_ms: runtimeMs,
});

test("attempt order runs oldest first, so #1 is the first thing they tried", () => {
  const ordered = submissionsInAttemptOrder([
    sub("c", "2026-09-15T04:30:00Z", true, 52),
    sub("a", "2026-09-15T04:05:00Z", false),
    sub("b", "2026-09-15T04:18:00Z", true, 91),
  ]);
  assert.deepEqual(
    ordered.map((s) => s.id),
    ["a", "b", "c"],
  );
});

test("submissions sharing a timestamp keep a stable order", () => {
  const same = "2026-09-15T04:05:00Z";
  const ordered = submissionsInAttemptOrder([sub("b", same, false), sub("a", same, false)]);
  assert.deepEqual(
    ordered.map((s) => s.id),
    ["a", "b"],
  );
});

test("attempt order leaves the caller's array alone", () => {
  const input = [
    sub("b", "2026-09-15T04:30:00Z", true, 52),
    sub("a", "2026-09-15T04:05:00Z", false),
  ];
  submissionsInAttemptOrder(input);
  assert.deepEqual(
    input.map((s) => s.id),
    ["b", "a"],
  );
});

test("no submissions orders to nothing", () => {
  assert.deepEqual(submissionsInAttemptOrder([]), []);
});

test("opens on the fastest accepted run, not the newest", () => {
  const ordered = submissionsInAttemptOrder([
    sub("a", "2026-09-15T04:05:00Z", false),
    sub("b", "2026-09-15T04:18:00Z", true, 52),
    sub("c", "2026-09-15T04:30:00Z", true, 91),
  ]);
  assert.equal(defaultSubmissionIndex(ordered), 1);
});

test("an accepted run without a runtime loses to one that has a runtime", () => {
  const ordered = submissionsInAttemptOrder([
    sub("a", "2026-09-15T04:05:00Z", true, null),
    sub("b", "2026-09-15T04:18:00Z", true, 91),
  ]);
  assert.equal(defaultSubmissionIndex(ordered), 1);
});

test("all accepted runs missing a runtime falls back to the earliest of them", () => {
  const ordered = submissionsInAttemptOrder([
    sub("a", "2026-09-15T04:05:00Z", true, null),
    sub("b", "2026-09-15T04:18:00Z", true, null),
  ]);
  assert.equal(defaultSubmissionIndex(ordered), 0);
});

test("nothing accepted opens on the latest attempt", () => {
  const ordered = submissionsInAttemptOrder([
    sub("a", "2026-09-15T04:05:00Z", false),
    sub("b", "2026-09-15T04:18:00Z", false),
    sub("c", "2026-09-15T04:30:00Z", false),
  ]);
  assert.equal(defaultSubmissionIndex(ordered), 2);
});

test("no submissions has no index to open", () => {
  assert.equal(defaultSubmissionIndex([]), 0);
});
