import { describe, expect, it } from "vitest";
import {
  applyEvent,
  checkpoints,
  codeAt,
  type EditEvent,
  finalCode,
  lineDiff,
  shouldSnapshot,
} from "./edits";

const ev = (t: number, v: number, c: EditEvent["c"], full?: string): EditEvent =>
  full === undefined ? { t, v, c } : { t, v, c, full };

describe("applyEvent", () => {
  it("inserts, replaces and deletes by offset", () => {
    expect(applyEvent("", ev(0, 1, [[0, 0, "abc"]]))).toBe("abc");
    expect(applyEvent("abc", ev(0, 2, [[1, 1, "X"]]))).toBe("aXc");
    expect(applyEvent("abc", ev(0, 3, [[0, 2, ""]]))).toBe("c");
  });

  it("applies multi-change events regardless of the order Monaco sends them", () => {
    // Two cursors typing "1" at pre-change offsets 0 and 1 of "ab" -> "1a1b"
    const forward: EditEvent = ev(0, 2, [
      [0, 0, "1"],
      [1, 0, "1"],
    ]);
    const backward: EditEvent = ev(0, 2, [
      [1, 0, "1"],
      [0, 0, "1"],
    ]);
    expect(applyEvent("ab", forward)).toBe("1a1b");
    expect(applyEvent("ab", backward)).toBe("1a1b");
    // Offsets always refer to the text before the event: 2 is the end of "ab".
    expect(
      applyEvent(
        "ab",
        ev(0, 2, [
          [0, 0, "1"],
          [2, 0, "1"],
        ]),
      ),
    ).toBe("1ab1");
  });

  it("a snapshot event replaces the text wholesale", () => {
    expect(applyEvent("whatever", ev(0, 9, [], "def f():\n  pass"))).toBe("def f():\n  pass");
  });

  it("throws on out-of-range offsets instead of corrupting silently", () => {
    expect(() => applyEvent("ab", ev(0, 1, [[5, 0, "x"]]))).toThrow(RangeError);
  });
});

describe("codeAt", () => {
  const events: EditEvent[] = [
    ev(1000, 1, [], "class Solution:\n"),
    ev(2000, 2, [[16, 0, "    def twoSum(self, nums, target):\n"]]),
    ev(3000, 3, [[52, 0, "        pass\n"]]),
    ev(60_000, 4, [], "class Solution:\n    def twoSum(self, nums, target):\n        return []\n"),
    ev(61_000, 5, [[60, 9, "return [0, 1]"]]),
  ];

  it("returns the initial text before the first event", () => {
    expect(codeAt(events, 500)).toBe("");
    expect(codeAt(events, 500, "seed")).toBe("seed");
  });

  it("replays edits up to and including t", () => {
    expect(codeAt(events, 1000)).toBe("class Solution:\n");
    expect(codeAt(events, 2500)).toBe("class Solution:\n    def twoSum(self, nums, target):\n");
    expect(codeAt(events, 3000)).toBe(
      "class Solution:\n    def twoSum(self, nums, target):\n        pass\n",
    );
  });

  it("uses the latest snapshot at or before t as its base", () => {
    expect(codeAt(events, 60_000)).toBe(
      "class Solution:\n    def twoSum(self, nums, target):\n        return []\n",
    );
    expect(codeAt(events, 99_999)).toBe(
      "class Solution:\n    def twoSum(self, nums, target):\n        return [0, 1]\n",
    );
    expect(finalCode(events)).toBe(codeAt(events, 61_000));
  });

  it("round-trips a random edit sequence against a naive model", () => {
    let text = "";
    const evs: EditEvent[] = [];
    let seed = 42;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let i = 0; i < 300; i++) {
      const offset = Math.floor(rand() * (text.length + 1));
      const length = Math.min(text.length - offset, Math.floor(rand() * 4));
      const insert = rand() < 0.7 ? String.fromCharCode(97 + Math.floor(rand() * 26)) : "";
      text = text.slice(0, offset) + insert + text.slice(offset + length);
      const snapshot = i % 50 === 0;
      evs.push(
        snapshot
          ? ev(i * 100, i, [[offset, length, insert]], text)
          : ev(i * 100, i, [[offset, length, insert]]),
      );
    }
    expect(finalCode(evs)).toBe(text);
    expect(codeAt(evs, 12_000)).toBe(codeAt(evs.slice(0, 121), 12_000));
  });
});

describe("shouldSnapshot", () => {
  it("snapshots on the first event, then every N events or M ms", () => {
    expect(shouldSnapshot(0, 0, true)).toBe(true);
    expect(shouldSnapshot(10, 1000, false)).toBe(false);
    expect(shouldSnapshot(50, 1000, false)).toBe(true);
    expect(shouldSnapshot(1, 30_000, false)).toBe(true);
  });
});

describe("checkpoints", () => {
  it("captures code at pause boundaries and the final state, de-duplicated", () => {
    const events: EditEvent[] = [
      ev(0, 1, [], "a"),
      ev(1000, 2, [[1, 0, "b"]]),
      ev(30_000, 3, [[2, 0, "c"]]), // 29s pause before -> boundary after event 2
      ev(31_000, 4, [[3, 0, "d"]]),
    ];
    expect(checkpoints(events, 20_000)).toEqual([
      { t: 1000, code: "ab" },
      { t: 31_000, code: "abcd" },
    ]);
  });
});

describe("lineDiff", () => {
  it("reports added and removed lines as multisets", () => {
    const d = lineDiff("a\nb\nc", "a\nc\nd\nd");
    expect(d.removed).toEqual(["b"]);
    expect(d.added.sort()).toEqual(["d", "d"]);
  });
});
