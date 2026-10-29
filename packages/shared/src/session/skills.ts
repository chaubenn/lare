import { z } from "zod";

/**
 * Skills from solved problems: the `solved_skills` RPC returns every distinct problem a user has
 * had accepted, with its LeetCode difficulty and topic tags; everything shown is derived here.
 */

const TagSchema = z.object({ slug: z.string(), name: z.string() });

export const SolvedSkillsSchema = z.object({
  /** False when the profile is private and the viewer is not an accepted follower. */
  visible: z.boolean(),
  problems: z.array(
    z.object({
      slug: z.string(),
      difficulty: z.enum(["Easy", "Medium", "Hard"]).nullable(),
      tags: z.array(TagSchema),
    }),
  ),
});
export type SolvedSkills = z.infer<typeof SolvedSkillsSchema>;

export function parseSolvedSkills(value: unknown): SolvedSkills | null {
  const parsed = SolvedSkillsSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export interface DifficultySplit {
  easy: number;
  medium: number;
  hard: number;
  total: number;
}

export function difficultySplit(skills: SolvedSkills): DifficultySplit {
  const split = { easy: 0, medium: 0, hard: 0, total: skills.problems.length };
  for (const p of skills.problems) {
    if (p.difficulty === "Easy") split.easy += 1;
    else if (p.difficulty === "Medium") split.medium += 1;
    else if (p.difficulty === "Hard") split.hard += 1;
  }
  return split;
}

export interface TopicStat extends DifficultySplit {
  slug: string;
  name: string;
}

/** Topics by problems solved, most first; each problem counts once per topic. */
export function topicStats(skills: SolvedSkills): TopicStat[] {
  const bySlug = new Map<string, TopicStat>();
  for (const p of skills.problems) {
    for (const tag of p.tags) {
      const stat = bySlug.get(tag.slug) ?? {
        slug: tag.slug,
        name: tag.name,
        easy: 0,
        medium: 0,
        hard: 0,
        total: 0,
      };
      stat.total += 1;
      if (p.difficulty === "Easy") stat.easy += 1;
      else if (p.difficulty === "Medium") stat.medium += 1;
      else if (p.difficulty === "Hard") stat.hard += 1;
      bySlug.set(tag.slug, stat);
    }
  }
  return [...bySlug.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}

/** The six areas the skills radar is drawn over, as LeetCode topic slugs. */
export const SKILL_AREAS = [
  {
    key: "arrays",
    label: "Arrays & strings",
    tags: [
      "array",
      "string",
      "matrix",
      "two-pointers",
      "sliding-window",
      "prefix-sum",
      "sorting",
      "simulation",
      "enumeration",
    ],
  },
  {
    key: "hashing",
    label: "Hash & math",
    tags: [
      "hash-table",
      "counting",
      "hash-function",
      "math",
      "bit-manipulation",
      "number-theory",
      "combinatorics",
      "geometry",
    ],
  },
  {
    key: "structures",
    label: "Stacks & heaps",
    tags: [
      "linked-list",
      "stack",
      "queue",
      "monotonic-stack",
      "monotonic-queue",
      "heap-priority-queue",
      "design",
      "ordered-set",
    ],
  },
  {
    key: "graphs",
    label: "Trees & graphs",
    tags: [
      "tree",
      "binary-tree",
      "binary-search-tree",
      "depth-first-search",
      "breadth-first-search",
      "graph",
      "topological-sort",
      "union-find",
      "trie",
      "shortest-path",
    ],
  },
  {
    key: "search",
    label: "Search & greedy",
    tags: ["binary-search", "greedy", "divide-and-conquer"],
  },
  {
    key: "dp",
    label: "DP & recursion",
    tags: ["dynamic-programming", "memoization", "backtracking", "recursion", "bitmask"],
  },
] as const;

export interface SkillArea {
  key: string;
  label: string;
  /** Problems solved that touch this area (a problem counts once per area). */
  solved: number;
  /** 0..1 against the strongest area, for drawing. */
  share: number;
}

export function skillAreas(skills: SolvedSkills): SkillArea[] {
  const counts = SKILL_AREAS.map((area) => {
    const tags = new Set<string>(area.tags);
    return skills.problems.filter((p) => p.tags.some((t) => tags.has(t.slug))).length;
  });
  const max = Math.max(1, ...counts);
  return SKILL_AREAS.map((area, i) => ({
    key: area.key,
    label: area.label,
    solved: counts[i] ?? 0,
    share: (counts[i] ?? 0) / max,
  }));
}
