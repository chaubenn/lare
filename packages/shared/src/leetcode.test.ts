import { describe, expect, it } from "vitest";
import {
  CheckResponseSchema,
  excerptFromHtml,
  isAccepted,
  isCheckUrl,
  isFinalCheck,
  isSubmitUrl,
  parseDistribution,
  parseMemoryMb,
  parseRuntimeMs,
  problemSlugFromUrl,
  submissionIdFromUrl,
  userBinIndex,
} from "./leetcode";

describe("urls", () => {
  it("extracts slugs from problem urls", () => {
    expect(problemSlugFromUrl("https://leetcode.com/problems/two-sum/")).toBe("two-sum");
    expect(problemSlugFromUrl("https://leetcode.com/problems/two-sum/description/?x=1")).toBe(
      "two-sum",
    );
    expect(problemSlugFromUrl("https://leetcode.com/problems/Two-Sum/submissions/123/")).toBe(
      "two-sum",
    );
    expect(problemSlugFromUrl("https://leetcode.com/problemset/")).toBeNull();
    expect(problemSlugFromUrl("https://example.com/problems/two-sum/")).toBeNull();
    expect(problemSlugFromUrl("not a url")).toBeNull();
  });

  it("detects judge endpoints", () => {
    expect(isSubmitUrl("https://leetcode.com/problems/two-sum/submit/")).toBe(true);
    expect(isSubmitUrl("https://leetcode.com/problems/two-sum/interpret_solution/")).toBe(false);
    expect(isCheckUrl("https://leetcode.com/submissions/detail/123456789/check/")).toBe(true);
    expect(submissionIdFromUrl("https://leetcode.com/submissions/detail/123456789/check/")).toBe(
      123456789,
    );
    expect(submissionIdFromUrl("https://leetcode.com/problems/two-sum/submissions/42/")).toBe(42);
  });
});

describe("check response", () => {
  const accepted = {
    status_code: 10,
    lang: "python3",
    run_success: true,
    status_runtime: "1219 ms",
    memory: 22000000,
    display_runtime: "1219",
    total_correct: 57,
    total_testcases: 57,
    runtime_percentile: 17.99,
    status_memory: "22 MB",
    memory_percentile: 5.34,
    pretty_lang: "Python3",
    submission_id: "1234567890",
    status_msg: "Accepted",
    state: "SUCCESS",
    extra_field_we_do_not_know: { nested: true },
  };

  it("parses leniently and classifies", () => {
    const c = CheckResponseSchema.parse(accepted);
    expect(isFinalCheck(c)).toBe(true);
    expect(isAccepted(c)).toBe(true);
    expect(parseRuntimeMs(c.status_runtime)).toBe(1219);
    expect(parseMemoryMb(c.status_memory)).toBe(22);
    expect(parseMemoryMb(c.memory)).toBe(22);
  });

  it("treats pending states as non-final", () => {
    const c = CheckResponseSchema.parse({ state: "PENDING" });
    expect(isFinalCheck(c)).toBe(false);
    expect(isAccepted(c)).toBe(false);
  });
});

describe("distribution", () => {
  const raw = JSON.stringify({
    lang: "python3",
    distribution: [
      ["140", "0.1"],
      ["386", 2.5],
      [633, "15.2"],
      ["879", "5"],
    ],
  });

  it("parses the stringified histogram and sorts bins", () => {
    const d = parseDistribution(raw);
    expect(d?.lang).toBe("python3");
    expect(d?.bins).toEqual([
      { value: 140, pct: 0.1 },
      { value: 386, pct: 2.5 },
      { value: 633, pct: 15.2 },
      { value: 879, pct: 5 },
    ]);
  });

  it("locates the user's bin", () => {
    const d = parseDistribution(raw);
    if (!d) throw new Error("expected distribution");
    expect(userBinIndex(d, 700)).toBe(2);
    expect(userBinIndex(d, 100)).toBe(0);
    expect(userBinIndex(d, 5000)).toBe(3);
  });

  it("returns null for junk", () => {
    expect(parseDistribution(null)).toBeNull();
    expect(parseDistribution("not json")).toBeNull();
    expect(parseDistribution('{"lang":"x","distribution":[]}')).toBeNull();
  });
});

describe("excerptFromHtml", () => {
  it("strips tags and entities and truncates", () => {
    const html = "<p>Given an array of integers <code>nums</code>&nbsp;and an integer <code>target</code>.</p>";
    expect(excerptFromHtml(html)).toBe("Given an array of integers nums and an integer target .");
    expect(excerptFromHtml(html, 12)).toBe("Given an ar…");
    expect(excerptFromHtml(null)).toBe("");
  });
});
