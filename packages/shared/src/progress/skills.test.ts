import { describe, expect, it } from "vitest";
import {
  difficultySplit,
  parseSolvedSkills,
  type SolvedSkills,
  skillAreas,
  topicStats,
} from "./skills";

const tag = (slug: string, name = slug) => ({ slug, name });
const SKILLS: SolvedSkills = {
  visible: true,
  problems: [
    {
      slug: "two-sum",
      difficulty: "Easy",
      tags: [tag("array", "Array"), tag("hash-table", "Hash Table")],
    },
    {
      slug: "longest-increasing-subsequence",
      difficulty: "Medium",
      tags: [
        tag("array", "Array"),
        tag("binary-search", "Binary Search"),
        tag("dynamic-programming", "Dynamic Programming"),
      ],
    },
    {
      slug: "edit-distance",
      difficulty: "Hard",
      tags: [tag("string", "String"), tag("dynamic-programming", "Dynamic Programming")],
    },
    { slug: "untagged", difficulty: null, tags: [] },
  ],
};

describe("difficultySplit", () => {
  it("counts each solved problem once by difficulty", () => {
    expect(difficultySplit(SKILLS)).toEqual({ easy: 1, medium: 1, hard: 1, total: 4 });
  });
});

describe("topicStats", () => {
  it("ranks topics by problems solved and splits each by difficulty", () => {
    const [first, second] = topicStats(SKILLS);
    expect(first).toMatchObject({ slug: "array", total: 2, easy: 1, medium: 1, hard: 0 });
    expect(second).toMatchObject({ slug: "dynamic-programming", total: 2, medium: 1, hard: 1 });
  });
});

describe("skillAreas", () => {
  it("counts a problem once per area and scales against the strongest area", () => {
    const areas = skillAreas(SKILLS);
    const arrays = areas.find((a) => a.key === "arrays");
    const dp = areas.find((a) => a.key === "dp");
    // two-sum and LIS (array), edit-distance (string): three problems, not four tag hits.
    expect(arrays).toMatchObject({ solved: 3, share: 1 });
    expect(dp?.solved).toBe(2);
    expect(dp?.share).toBeCloseTo(2 / 3);
  });
});

describe("parseSolvedSkills", () => {
  it("rejects malformed payloads", () => {
    expect(parseSolvedSkills({ visible: true, problems: [{ slug: 1 }] })).toBeNull();
    expect(parseSolvedSkills(SKILLS)).toEqual(SKILLS);
  });
});
