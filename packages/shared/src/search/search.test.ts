import { describe, expect, it } from "vitest";
import {
  arrangeHits,
  fallbackSearch,
  personSearchDoc,
  postSearchDoc,
  reviewSearchDoc,
  type SearchDoc,
  type SearchHit,
  type SessionSearchInput,
  searchText,
  sessionSearchDoc,
  transcriptSearchDoc,
} from "./search";

const validPalindrome: SessionSearchInput["problems"][number] = {
  title: "Valid Palindrome",
  slug: "valid-palindrome",
  frontendId: "125",
  difficulty: "Easy",
  tags: [
    { name: "Two Pointers", slug: "two-pointers" },
    { name: "String", slug: "string" },
  ],
  submissions: [
    { lang: "python3", status: "Wrong Answer", accepted: false },
    { lang: "python3", status: "Accepted", accepted: true },
  ],
};

const palindrome: SessionSearchInput = {
  id: "s1",
  kind: "practice",
  startedAt: "2026-10-30T10:00:00.000Z",
  problems: [validPalindrome],
};

const hit = (doc: SearchDoc, score = 1): SearchHit => {
  const { text: _text, ...rest } = doc;
  return { ...rest, score };
};

describe("sessionSearchDoc", () => {
  it("names the session after its problems and opens its review page", () => {
    const doc = sessionSearchDoc(palindrome);
    expect(doc).toMatchObject({
      id: "session:s1",
      kind: "session",
      title: "Valid Palindrome",
      route: "/sessions/s1",
      at: Date.parse("2026-10-30T10:00:00.000Z"),
    });
  });

  it("makes tags, difficulty, language and outcome searchable", () => {
    const { text, subtitle } = sessionSearchDoc(palindrome);
    for (const word of [
      "two pointers",
      "easy",
      "python3",
      "accepted",
      "wrong answer",
      "solved",
      "125",
    ]) {
      expect(text.toLowerCase()).toContain(word);
    }
    expect(subtitle).toBe("Practice · Easy · Solved");
  });

  it("calls a session with only failing submissions failed", () => {
    const failed = sessionSearchDoc({
      ...palindrome,
      problems: [
        {
          ...validPalindrome,
          submissions: [{ lang: "java", status: "Time Limit Exceeded", accepted: false }],
        },
      ],
    });
    expect(failed.text).toContain("failed");
    expect(failed.text).not.toContain("solved");
    expect(failed.subtitle).toBe("Practice · Easy · Failed");
  });

  it("joins several problems and names an empty interview", () => {
    const two = sessionSearchDoc({
      ...palindrome,
      problems: [validPalindrome, { ...validPalindrome, title: "Two Sum" }],
    });
    expect(two.title).toBe("Valid Palindrome · Two Sum");
    const empty = sessionSearchDoc({ ...palindrome, kind: "interview", problems: [] });
    expect(empty.title).toBe("Mock interview");
    expect(empty.subtitle).toBe("Interview");
  });
});

describe("postSearchDoc", () => {
  it("sends drafts to the editor and published posts to the post page", () => {
    const base = {
      id: "p1",
      title: "Cracked sliding window",
      body: "Finally got it",
      publishedAt: null,
      updatedAt: "2026-10-01T00:00:00.000Z",
    };
    expect(postSearchDoc({ ...base, status: "draft" })).toMatchObject({
      id: "post:p1",
      kind: "draft",
      route: "/drafts/p1",
      at: Date.parse(base.updatedAt),
    });
    expect(
      postSearchDoc({ ...base, status: "published", publishedAt: "2026-10-02T00:00:00.000Z" }),
    ).toMatchObject({
      kind: "post",
      route: "/posts/p1",
      at: Date.parse("2026-10-02T00:00:00.000Z"),
    });
  });

  it("titles an untitled draft", () => {
    const doc = postSearchDoc({
      id: "p2",
      status: "draft",
      title: null,
      body: null,
      publishedAt: null,
      updatedAt: "2026-10-01T00:00:00.000Z",
    });
    expect(doc.title).toBe("Untitled draft");
  });
});

describe("personSearchDoc", () => {
  it("opens the profile and matches the handle", () => {
    expect(personSearchDoc({ id: "u1", handle: "ben", displayName: "Ben Chau" })).toMatchObject({
      id: "person:u1",
      kind: "person",
      title: "Ben Chau",
      subtitle: "@ben",
      route: "/u/ben",
    });
    expect(personSearchDoc({ id: "u2", handle: "paul", displayName: null }).title).toBe("paul");
  });
});

describe("transcript and review docs", () => {
  it("keeps what was said, keyed to the session", () => {
    const doc = transcriptSearchDoc({
      sessionId: "s1",
      title: "Valid Palindrome",
      segments: [{ text: "I'll use a hashmap" }, { text: "then two pointers" }],
      createdAt: "2026-10-30T11:00:00.000Z",
    });
    expect(doc).toMatchObject({
      id: "said:transcript:s1",
      kind: "said",
      subtitle: "Transcript",
      route: "/sessions/s1",
    });
    expect(doc.text).toBe("I'll use a hashmap then two pointers");
  });

  it("indexes the review summary, moments and next steps", () => {
    const doc = reviewSearchDoc({
      sessionId: "s1",
      title: "Valid Palindrome",
      summary: "Solid approach.",
      moments: [{ quote: "i'll sort it", comment: "Sorting is unnecessary" }],
      nextSteps: ["Practice sliding window"],
      createdAt: "2026-10-30T11:00:00.000Z",
    });
    expect(doc.id).toBe("said:review:s1");
    expect(doc.subtitle).toBe("AI review");
    for (const part of [
      "Solid approach.",
      "i'll sort it",
      "Sorting is unnecessary",
      "Practice sliding window",
    ]) {
      expect(doc.text).toContain(part);
    }
  });
});

describe("searchText", () => {
  it("drops a leading recency word, since results already come newest first", () => {
    expect(searchText("last palindrome")).toBe("palindrome");
    expect(searchText("  Latest   two sum ")).toBe("two sum");
    expect(searchText("most recent dp")).toBe("dp");
    expect(searchText("last")).toBe("last");
    expect(searchText("lastly")).toBe("lastly");
  });
});

describe("arrangeHits", () => {
  const older = hit({ ...sessionSearchDoc(palindrome), id: "session:old", at: 1 }, 9);
  const newer = hit({ ...sessionSearchDoc(palindrome), id: "session:new", at: 2 }, 1);
  const person = hit(personSearchDoc({ id: "u1", handle: "ben", displayName: null }));

  it("groups by kind in a fixed order and puts the newest session first", () => {
    const groups = arrangeHits([person, older, newer]);
    expect(groups.map((g) => g.label)).toEqual(["Sessions", "People"]);
    expect(groups[0]?.hits.map((h) => h.id)).toEqual(["session:new", "session:old"]);
  });

  it("caps each group", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ ...newer, id: `session:${i}`, at: i }));
    expect(arrangeHits(many)[0]?.hits).toHaveLength(8);
  });

  it("puts posts and drafts in one group", () => {
    const draft = hit(
      postSearchDoc({
        id: "p1",
        status: "draft",
        title: "x",
        body: null,
        publishedAt: null,
        updatedAt: "2026-10-01T00:00:00.000Z",
      }),
    );
    expect(arrangeHits([draft]).map((g) => g.label)).toEqual(["Posts & drafts"]);
  });
});

describe("fallbackSearch", () => {
  const docs = [
    sessionSearchDoc(palindrome),
    sessionSearchDoc({
      ...palindrome,
      id: "s2",
      problems: [{ ...validPalindrome, title: "Two Sum", slug: "two-sum", frontendId: "1" }],
    }),
  ];

  it("needs every word, matching parts of words without case", () => {
    expect(fallbackSearch(docs, "PALIN").map((h) => h.id)).toEqual(["session:s1"]);
    expect(fallbackSearch(docs, "two sum").map((h) => h.id)).toEqual(["session:s2"]);
    expect(fallbackSearch(docs, "palin sum")).toEqual([]);
  });

  it("returns hits without their text", () => {
    expect(fallbackSearch(docs, "palindrome")[0]).not.toHaveProperty("text");
  });
});

describe("dates", () => {
  it("indexes a date that does not parse as 0", () => {
    expect(sessionSearchDoc({ ...palindrome, startedAt: "not a date" }).at).toBe(0);
  });
});
