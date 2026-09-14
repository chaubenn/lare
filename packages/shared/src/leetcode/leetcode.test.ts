import { describe, expect, it } from "vitest";
import {
  CheckResponseSchema,
  excerptFromHtml,
  isAccepted,
  isCheckGraphql,
  isCheckUrl,
  isFinalCheck,
  isGraphqlUrl,
  isJudgeFailure,
  isSubmitGraphql,
  isSubmitUrl,
  looksLikeCheckPayload,
  normalizeCheckPayload,
  parseDistribution,
  parseMemoryMb,
  parseRuntimeMs,
  problemSlugFromUrl,
  submissionIdFromPayload,
  submissionIdFromUrl,
  unwrapCheckPayload,
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
    expect(isSubmitUrl("https://leetcode.com/problems/two-sum/submit")).toBe(true);
    expect(isSubmitUrl("https://leetcode.com/problems/single-number/submit/?foo=1")).toBe(true);
    expect(isSubmitUrl("https://leetcode.com/problems/two-sum/interpret_solution/")).toBe(false);
    expect(isCheckUrl("https://leetcode.com/submissions/detail/123456789/check/")).toBe(true);
    expect(isCheckUrl("https://leetcode.com/submissions/123456789/check/?t=1")).toBe(true);
    // Current leetcode.com Submit flow polls `submitResultV2`.
    expect(isCheckUrl("https://leetcode.com/submissions/detail/123456789/v2/check/")).toBe(true);
    expect(isCheckUrl("https://leetcode.com/submissions/detail/123456789/v3/check")).toBe(true);
    expect(isCheckUrl("https://leetcode.com/submissions/detail/123456789/")).toBe(false);
    expect(submissionIdFromUrl("https://leetcode.com/submissions/detail/123456789/check/")).toBe(
      123456789,
    );
    expect(submissionIdFromUrl("https://leetcode.com/submissions/detail/123456789/v2/check/")).toBe(
      123456789,
    );
    expect(submissionIdFromUrl("https://leetcode.com/problems/two-sum/submissions/42/")).toBe(42);
  });
});

describe("graphql judge helpers", () => {
  it("recognises graphql submit and extracts nested ids", () => {
    expect(isGraphqlUrl("https://leetcode.com/graphql")).toBe(true);
    expect(isSubmitGraphql('{"operationName":"submitCode","query":"mutation submitCode"}')).toBe(
      true,
    );
    expect(
      isSubmitGraphql(
        '{"query":"mutation submitCode($code: String!) { submitCode(code: $code) }"}',
      ),
    ).toBe(true);
    expect(isSubmitGraphql('{"operationName":"interpretSolution"}')).toBe(false);
    expect(submissionIdFromPayload({ submission_id: "99" })).toBe(99);
    expect(submissionIdFromPayload({ data: { submitCode: { submissionId: 42 } } })).toBe(42);
    expect(isCheckGraphql('{"operationName":"checkSubmission"}')).toBe(true);
    expect(
      isCheckGraphql('{"query":"query checkSubmission($id: Int!) { checkSubmission(id: $id) }"}'),
    ).toBe(true);
    expect(
      looksLikeCheckPayload({
        data: { checkSubmission: { state: "SUCCESS", status_code: 10, total_testcases: 10 } },
      }),
    ).toBe(true);
    expect(
      unwrapCheckPayload({
        data: { checkSubmission: { state: "SUCCESS", status_code: 10 } },
      }),
    ).toEqual({ state: "SUCCESS", status_code: 10 });
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

  it("treats v2 in-flight judge states as non-final", () => {
    for (const state of ["STARTED", "PREPARING", "COMPILING", "RUNNING_TESTS"]) {
      expect(isFinalCheck(CheckResponseSchema.parse({ state }))).toBe(false);
    }
  });

  it("waits for the v2 AI judge to settle", () => {
    const judging = CheckResponseSchema.parse({
      state: "SUCCESS",
      ai_state: "STARTED",
      status_code: 10,
      total_testcases: 57,
    });
    expect(isFinalCheck(judging)).toBe(false);
    const done = CheckResponseSchema.parse({ ...judging, ai_state: "SUCCESS" });
    expect(isFinalCheck(done)).toBe(true);
    expect(isJudgeFailure(done)).toBe(false);
  });

  it("flags settled checks without a verdict as judge failures", () => {
    const c = CheckResponseSchema.parse({ state: "FAILURE" });
    expect(isFinalCheck(c)).toBe(true);
    expect(isJudgeFailure(c)).toBe(true);
    const wa = CheckResponseSchema.parse({ state: "SUCCESS", status_code: 11 });
    expect(isJudgeFailure(wa)).toBe(false);
  });

  it("downgrades AC to WA when compare_result has a failing case", () => {
    const c = CheckResponseSchema.parse({
      state: "SUCCESS",
      status_code: 10,
      compare_result: "1110111",
    });
    expect(isAccepted(c)).toBe(false);
  });

  it("normalizes camelCase graphql check payloads with string numbers", () => {
    const normalized = normalizeCheckPayload({
      data: {
        checkSubmission: {
          statusCode: 10,
          statusDisplay: "Accepted",
          totalTestcases: "57",
          finished: true,
        },
      },
    }) as Record<string, unknown>;
    expect(normalized.state).toBe("SUCCESS");
    expect(normalized.status_code).toBe(10);
    const parsed = CheckResponseSchema.parse(normalized);
    expect(isFinalCheck(parsed)).toBe(true);
    expect(isAccepted(parsed)).toBe(true);
    expect(parsed.total_testcases).toBe(57);
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
    const html =
      "<p>Given an array of integers <code>nums</code>&nbsp;and an integer <code>target</code>.</p>";
    expect(excerptFromHtml(html)).toBe("Given an array of integers nums and an integer target .");
    expect(excerptFromHtml(html, 12)).toBe("Given an ar…");
    expect(excerptFromHtml(null)).toBe("");
  });
});
