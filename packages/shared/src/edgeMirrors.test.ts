import { describe, expect, it } from "vitest";
import { z } from "zod";
import { aiReviewJsonSchema } from "../../../supabase/functions/_shared/aiReviewSchema";
import * as edge from "../../../supabase/functions/_shared/edits";
import * as edgeCriteria from "../../../supabase/functions/_shared/reviewCriteria";
import {
  AiReviewSchema,
  DEFAULT_REVIEW_CRITERIA,
  REVIEW_CRITERIA_MAX_LENGTH,
} from "./session/ai-review";
import { applyEvent, checkpoints, type EditEvent, lineDiff } from "./session/edits";
import { pausedIntervals, type TimerEvent, toMediaMs } from "./session/timer";

// Edge Functions run on Deno and cannot import this package, so supabase/functions/_shared holds
// hand copies of a few modules. These tests are what ties each copy to its original.

/** A JSON Schema reduced to what both spellings of it must agree on. */
function shape(schema: unknown): unknown {
  const s = schema as Record<string, unknown>;
  if (Array.isArray(s.anyOf)) return s.anyOf.flatMap(shape).sort();
  if (Array.isArray(s.type)) return [...s.type].sort();
  if (s.enum) return { enum: [...(s.enum as string[])].sort() };
  if (s.type === "object") {
    const properties = s.properties as Record<string, unknown>;
    return {
      required: [...(s.required as string[])].sort(),
      closed: s.additionalProperties === false,
      properties: Object.fromEntries(
        Object.keys(properties)
          .sort()
          .map((key) => [key, shape(properties[key])]),
      ),
    };
  }
  if (s.type === "array") return { items: shape(s.items) };
  if (s.type === "integer") {
    const bound = (n: unknown) => (typeof n === "number" && Math.abs(n) < 2 ** 53 - 1 ? n : null);
    return { integer: [bound(s.minimum), bound(s.maximum)] };
  }
  return [s.type];
}

describe("supabase/functions/_shared mirrors", () => {
  it("reviewCriteria.ts carries the same default criteria and length limit", () => {
    expect(edgeCriteria.DEFAULT_REVIEW_CRITERIA).toBe(DEFAULT_REVIEW_CRITERIA);
    expect(edgeCriteria.REVIEW_CRITERIA_MAX_LENGTH).toBe(REVIEW_CRITERIA_MAX_LENGTH);
  });

  it("aiReviewSchema.ts asks OpenAI for exactly what AiReviewSchema accepts", () => {
    expect(shape(aiReviewJsonSchema)).toEqual(
      shape(z.toJSONSchema(AiReviewSchema, { target: "draft-2020-12" })),
    );
  });

  const events: EditEvent[] = [
    { t: 1_000, v: 1, c: [], full: "def f():\n  pass" },
    { t: 2_000, v: 2, c: [[13, 2, "return 1"]] },
    {
      t: 40_000,
      v: 3,
      c: [
        [0, 0, "# two cursors\n"],
        [4, 1, "g"],
      ],
    },
    { t: 41_000, v: 4, c: [[0, 14, ""]] },
    { t: 90_000, v: 5, c: [], full: "def g():\n  return 2" },
  ];

  it("edits.ts replays an edit log to the same checkpoints and diffs", () => {
    expect(edge.checkpoints(events)).toEqual(checkpoints(events));
    expect(edge.checkpoints(events, 500)).toEqual(checkpoints(events, 500));
    let text = "";
    for (const event of events) {
      expect(edge.applyEvent(text, event)).toBe(applyEvent(text, event));
      text = applyEvent(text, event);
    }
    const [first, last] = [checkpoints(events)[0]?.code ?? "", text];
    expect(edge.lineDiff(first, last)).toEqual(lineDiff(first, last));
  });

  it("edits.ts differs on a corrupt log only: the reviewer skips the event, the app throws", () => {
    const corrupt: EditEvent = { t: 1, v: 1, c: [[99, 0, "x"]] };
    expect(edge.applyEvent("abc", corrupt)).toBe("abc");
    expect(() => applyEvent("abc", corrupt)).toThrow(RangeError);
  });

  it("edits.ts maps wall-clock time to media time the same way", () => {
    const timer: TimerEvent[] = [
      { t: 0, type: "start" },
      { t: 10_000, type: "pause" },
      { t: 15_000, type: "resume" },
      { t: 30_000, type: "pause" },
      { t: 31_000, type: "pause" },
      { t: 40_000, type: "end" },
    ];
    for (const now of [35_000, 50_000]) {
      for (const log of [timer, timer.slice(0, 5)]) {
        const pauses = pausedIntervals(log, now);
        expect(edge.pausedIntervals(log, now)).toEqual(pauses);
        for (const at of [0, 5_000, 12_000, 15_000, 29_000, 33_000, 45_000]) {
          for (const t0 of [0, 12_000]) {
            expect(edge.toMediaMs(at, t0, pauses)).toBe(toMediaMs(at, t0, pauses));
          }
        }
      }
    }
  });
});
