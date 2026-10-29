import assert from "node:assert/strict";
import { test } from "node:test";
import { groupSittings } from "../src/features/sessions/grouping.ts";

const at = (iso) => new Date(iso).toISOString();
const session = (id, kind, start, activeMin, problems = ["two-sum"], extra = {}) => ({
  id,
  kind,
  started_at: at(start),
  ended_at: new Date(Date.parse(start) + activeMin * 60_000).toISOString(),
  active_ms: activeMin * 60_000,
  session_problems: problems.map((slug) => ({ slug, title: slug, difficulty: "Easy" })),
  ...extra,
});

test("close sessions bundle into one sitting, newest sitting first", () => {
  const sittings = groupSittings([
    session("a", "interview", "2026-09-15T04:34:00Z", 1),
    session("b", "interview", "2026-09-15T04:10:00Z", 1),
    session("c", "practice", "2026-09-15T04:05:00Z", 0),
    session("d", "interview", "2026-09-07T03:37:00Z", 1),
    session("e", "interview", "2026-09-07T00:45:00Z", 1),
  ]);
  assert.deepEqual(
    sittings.map((s) => s.sessions.map((x) => x.id)),
    [["a", "b", "c"], ["d"], ["e"]],
  );
  assert.equal(sittings[0].label, "Practice & mock interview");
  assert.equal(sittings[1].label, "Mock interview");
});

test("repeated problems collapse to one entry with an attempt count", () => {
  const [sitting] = groupSittings([
    session("a", "interview", "2026-09-15T04:34:00Z", 1, ["two-sum"]),
    session("b", "practice", "2026-09-15T04:22:00Z", 0, ["two-sum", "lru-cache"]),
    session("c", "practice", "2026-09-15T04:05:00Z", 0, ["two-sum"]),
  ]);
  assert.deepEqual(
    sitting.problems.map((p) => [p.slug, p.attempts]),
    [
      ["two-sum", 3],
      ["lru-cache", 1],
    ],
  );
  assert.equal(sitting.interviews, 1);
  assert.equal(sitting.practices, 2);
});

test("a long session keeps the next one in its sitting; the practice inbox never appears", () => {
  const sittings = groupSittings([
    // Starts 3h after the previous one started, but only 1h after it ended.
    session("late", "practice", "2026-09-15T12:00:00Z", 10),
    session("long", "interview", "2026-09-15T09:00:00Z", 120),
    session("inbox", "practice", "2026-09-15T11:00:00Z", 0, ["x"], { is_practice_inbox: true }),
  ]);
  assert.deepEqual(
    sittings.map((s) => s.sessions.map((x) => x.id)),
    [["late", "long"]],
  );
});
