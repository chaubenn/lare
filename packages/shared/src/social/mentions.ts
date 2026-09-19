/**
 * `@handle` mentions in comments. The database finds them with the same rule
 * (`private.comment_mentions`) to decide who gets notified; this side renders them as links and
 * drives the composer's autocomplete. Handles are 3-20 of [a-z0-9_], and an `@` glued to a word
 * (an email address) is not a mention.
 */

export type MentionSegment = { kind: "text"; text: string } | { kind: "mention"; handle: string };

const MENTION = /(^|[^a-z0-9_])@([a-z0-9_]{3,20})(?![a-z0-9_])/gi;

/** Splits a comment body into plain text and mentions, in order. */
export function splitMentions(body: string): MentionSegment[] {
  const segments: MentionSegment[] = [];
  let last = 0;
  for (const match of body.matchAll(MENTION)) {
    const at = (match.index ?? 0) + (match[1]?.length ?? 0);
    if (at > last) segments.push({ kind: "text", text: body.slice(last, at) });
    segments.push({ kind: "mention", handle: (match[2] ?? "").toLowerCase() });
    last = at + 1 + (match[2]?.length ?? 0);
  }
  if (last < body.length) segments.push({ kind: "text", text: body.slice(last) });
  return segments;
}

/**
 * The mention being typed at the caret, if any: `{ start, query }` where `start` is the index of
 * the `@`. The query may be empty (just typed `@`) so the picker can open straight away.
 */
export function mentionAtCaret(
  text: string,
  caret: number,
): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const match = /(^|[^a-z0-9_])@([a-z0-9_]{0,20})$/i.exec(before);
  if (!match) return null;
  const query = match[2] ?? "";
  return { start: caret - query.length - 1, query: query.toLowerCase() };
}

/** Replaces the mention being typed with `@handle ` and returns the new text and caret. */
export function insertMention(
  text: string,
  mention: { start: number; query: string },
  handle: string,
): { text: string; caret: number } {
  const end = mention.start + 1 + mention.query.length;
  const inserted = `@${handle} `;
  const rest = text.slice(end).replace(/^ /, "");
  return {
    text: text.slice(0, mention.start) + inserted + rest,
    caret: mention.start + inserted.length,
  };
}
