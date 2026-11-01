/**
 * Command palette search: what gets indexed for a signed-in user and how the hits are shown.
 *
 * The desktop app keeps these docs in a local Zvec index (`src-tauri/src/search.rs`). Short docs
 * (sessions, posts, people) match any part of a word as it is typed; long ones (`said`:
 * transcripts and AI reviews) match whole words. Everything here is pure so it can be tested
 * without the index.
 */

export type SearchKind = "session" | "said" | "post" | "draft" | "person";

export interface SearchDoc {
  /** `<kind>:<row id>`, unique across kinds. */
  id: string;
  kind: SearchKind;
  title: string;
  subtitle: string;
  /** In-app route the palette navigates to. */
  route: string;
  /** Epoch ms used to put the newest first; 0 when the doc has no date. */
  at: number;
  /** Everything matched against, beyond the title. */
  text: string;
}

export type SearchHit = Omit<SearchDoc, "text"> & { score: number };

export interface SearchGroup {
  label: string;
  hits: SearchHit[];
}

/** Shorter queries are left to the page shortcuts: the index matches two characters or more. */
export const SEARCH_MIN_QUERY = 2;

export interface SessionSearchInput {
  id: string;
  kind: "practice" | "interview";
  startedAt: string;
  problems: {
    title: string;
    slug: string;
    frontendId: string | null;
    difficulty: string | null;
    tags: { name: string; slug: string }[];
    submissions: { lang: string | null; status: string | null; accepted: boolean }[];
  }[];
}

/** The problems a session covered, or what kind of session it was when it covered none. */
export function sessionSearchTitle(session: Pick<SessionSearchInput, "kind" | "problems">): string {
  if (session.problems.length > 0) return session.problems.map((p) => p.title).join(" · ");
  return session.kind === "interview" ? "Mock interview" : "Practice session";
}

export function sessionSearchDoc(session: SessionSearchInput): SearchDoc {
  const submissions = session.problems.flatMap((p) => p.submissions);
  const outcome =
    submissions.length === 0 ? null : submissions.some((s) => s.accepted) ? "Solved" : "Failed";
  const difficulties = unique(session.problems.map((p) => p.difficulty));
  const kind = session.kind === "interview" ? "Interview" : "Practice";
  const text = [
    kind,
    ...session.problems.flatMap((p) => [
      p.frontendId,
      p.slug.replaceAll("-", " "),
      ...p.tags.map((t) => t.name),
    ]),
    ...difficulties,
    ...unique(submissions.map((s) => s.lang)),
    ...unique(submissions.map((s) => s.status)),
    outcome,
  ];
  return {
    id: `session:${session.id}`,
    kind: "session",
    title: sessionSearchTitle(session),
    subtitle: [kind, ...difficulties, outcome].filter(Boolean).join(" · "),
    route: `/sessions/${session.id}`,
    at: epochMs(session.startedAt),
    text: words(text).toLowerCase(),
  };
}

export function postSearchDoc(post: {
  id: string;
  status: "draft" | "published";
  title: string | null;
  body: string | null;
  publishedAt: string | null;
  updatedAt: string;
}): SearchDoc {
  const draft = post.status === "draft";
  return {
    id: `post:${post.id}`,
    kind: draft ? "draft" : "post",
    title: post.title?.trim() || (draft ? "Untitled draft" : "Untitled post"),
    subtitle: draft ? "Draft" : "Post",
    route: draft ? `/drafts/${post.id}` : `/posts/${post.id}`,
    at: epochMs(post.publishedAt ?? post.updatedAt),
    text: post.body ?? "",
  };
}

export function personSearchDoc(person: {
  id: string;
  handle: string;
  displayName: string | null;
}): SearchDoc {
  return {
    id: `person:${person.id}`,
    kind: "person",
    title: person.displayName?.trim() || person.handle,
    subtitle: `@${person.handle}`,
    route: `/u/${person.handle}`,
    at: 0,
    text: person.handle,
  };
}

/** Transcripts can run to an hour of speech; the index does not need more than this of one. */
const SAID_MAX_CHARS = 50_000;

export function transcriptSearchDoc(input: {
  sessionId: string;
  title: string;
  segments: { text: string }[];
  createdAt: string;
}): SearchDoc {
  return saidDoc(input, "transcript", "Transcript", words(input.segments.map((s) => s.text)));
}

export function reviewSearchDoc(input: {
  sessionId: string;
  title: string;
  summary: string | null;
  moments: { quote: string; comment: string }[];
  nextSteps: string[];
  createdAt: string;
}): SearchDoc {
  const text = words([
    input.summary,
    ...input.moments.flatMap((m) => [m.quote, m.comment]),
    ...input.nextSteps,
  ]);
  return saidDoc(input, "review", "AI review", text);
}

function saidDoc(
  input: { sessionId: string; title: string; createdAt: string },
  source: string,
  subtitle: string,
  text: string,
): SearchDoc {
  return {
    id: `said:${source}:${input.sessionId}`,
    kind: "said",
    title: input.title,
    subtitle,
    route: `/sessions/${input.sessionId}`,
    at: epochMs(input.createdAt),
    text: text.slice(0, SAID_MAX_CHARS),
  };
}

const RECENCY_PREFIX = /^(?:most recent|last|latest|newest|recent|previous)\s+/i;

/**
 * The part of a palette query to search for. "last palindrome" means the same as "palindrome":
 * dated results always come newest first, so a leading recency word only gets in the way.
 */
export function searchText(raw: string): string {
  const text = raw.trim().replace(/\s+/g, " ");
  return text.replace(RECENCY_PREFIX, "") || text;
}

const GROUPS: { label: string; kinds: SearchKind[]; limit: number; newestFirst: boolean }[] = [
  { label: "Sessions", kinds: ["session"], limit: 8, newestFirst: true },
  { label: "In your interviews", kinds: ["said"], limit: 5, newestFirst: true },
  { label: "Posts & drafts", kinds: ["post", "draft"], limit: 5, newestFirst: true },
  { label: "People", kinds: ["person"], limit: 5, newestFirst: false },
];

/** Hits grouped for the palette, newest first where they are dated, empty groups dropped. */
export function arrangeHits(hits: SearchHit[]): SearchGroup[] {
  return GROUPS.flatMap(({ label, kinds, limit, newestFirst }) => {
    const group = hits.filter((h) => kinds.includes(h.kind));
    if (newestFirst) group.sort((a, b) => b.at - a.at);
    return group.length > 0 ? [{ label, hits: group.slice(0, limit) }] : [];
  });
}

/**
 * Plain substring search over the same docs, for when the index cannot run (it needs AVX2 on
 * x86 machines). Every word of the query has to appear somewhere in the doc.
 */
export function fallbackSearch(docs: readonly SearchDoc[], query: string): SearchHit[] {
  const terms = searchText(query).toLowerCase().split(" ").filter(Boolean);
  if (terms.length === 0) return [];
  return docs.flatMap(({ text, ...doc }) => {
    const haystack = `${doc.title} ${text}`.toLowerCase();
    return terms.every((t) => haystack.includes(t)) ? [{ ...doc, score: 1 }] : [];
  });
}

/** The index stores `at` as an integer, so a date that does not parse becomes 0, not NaN. */
function epochMs(iso: string): number {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}

function words(parts: readonly (string | null | undefined)[]): string {
  return parts
    .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
    .map((p) => p.trim())
    .join(" ");
}

function unique(values: readonly (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((v): v is string => typeof v === "string" && v.length > 0))];
}
