/**
 * The light formatting post write-ups and comments carry: a small Markdown subset, stored as the
 * text itself so everything that reads the column as plain text keeps working. In particular the
 * database finds `@handle` mentions in the raw body (`private.comment_mentions`), so nothing here
 * ever escapes a character: `@snake_case` has to reach the column exactly as typed.
 *
 * Blocks are line-based, one line per paragraph as in the plain text this replaced:
 *   `#`, `##`, `###` headings, `- item` / `1. item` lists, `> quote` lines, and ``` fenced code
 *   with an optional language (```python, ```java, ```cpp).
 * Inline: `**bold**`, `_italic_` (or `*italic*` inside a word), `~~struck~~`, `` `code` ``.
 * Bare `http(s)://` URLs become links, `@handle` becomes a mention. Anything that does not parse
 * stays literal text, so no input is ever rejected or lost.
 */
import { HANDLE_CHAR, HANDLE_MAX_LENGTH, HANDLE_MIN_LENGTH } from "../format/handle";
import { normalizeCodeLanguage } from "./code";

export type RichFormat = "bold" | "italic" | "strike";

export type RichInline =
  | { kind: "text"; text: string }
  | { kind: "mention"; handle: string }
  | { kind: "link"; url: string }
  | { kind: "code"; text: string }
  | { kind: RichFormat; children: RichInline[] };

export type HeadingLevel = 1 | 2 | 3;

export type RichBlock =
  | { kind: "paragraph"; content: RichInline[] }
  | { kind: "heading"; level: HeadingLevel; content: RichInline[] }
  | { kind: "list"; ordered: boolean; start: number; items: RichInline[][] }
  | { kind: "quote"; lines: RichInline[][] }
  /** `language` is as written after the fence, normalised when it is one we highlight. */
  | { kind: "code"; text: string; language: string | null };

const BULLET = /^[-*+] (.*)$/;
const ORDERED = /^(\d{1,9})[.)] (.*)$/;
const QUOTE = /^> ?(.*)$/;
const HEADING = /^(#{1,3}) (.*)$/;
const FENCE = /^```\s*([^\s`]*)/;
const FENCE_CLOSE = /^```\s*$/;

/** Splits stored text into blocks. Never throws; unknown syntax is a paragraph of text. */
export function parseRichText(source: string): RichBlock[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: RichBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    const fence = FENCE.exec(line);
    if (fence) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !FENCE_CLOSE.test(lines[i] ?? "")) code.push(lines[i++] ?? "");
      i++; // the closing fence, or past the end when it was never closed
      blocks.push({
        kind: "code",
        text: code.join("\n"),
        language: fence[1] ? normalizeCodeLanguage(fence[1]) : null,
      });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({
        kind: "heading",
        level: (heading[1]?.length ?? 1) as HeadingLevel,
        content: parseInline(heading[2] ?? ""),
      });
      i++;
      continue;
    }
    const bullet = BULLET.exec(line);
    const ordered = bullet ? null : ORDERED.exec(line);
    if (bullet || ordered) {
      const isOrdered = ordered !== null;
      const pattern = isOrdered ? ORDERED : BULLET;
      const items: RichInline[][] = [];
      for (let match = pattern.exec(line); match; match = pattern.exec(lines[i] ?? "")) {
        items.push(parseInline((isOrdered ? match[2] : match[1]) ?? ""));
        if (++i >= lines.length) break;
      }
      blocks.push({
        kind: "list",
        ordered: isOrdered,
        start: isOrdered ? Number(ordered?.[1] ?? 1) : 1,
        items,
      });
      continue;
    }
    if (QUOTE.test(line)) {
      const quoted: RichInline[][] = [];
      for (let match = QUOTE.exec(line); match; match = QUOTE.exec(lines[i] ?? "")) {
        quoted.push(parseInline(match[1] ?? ""));
        if (++i >= lines.length) break;
      }
      blocks.push({ kind: "quote", lines: quoted });
      continue;
    }
    blocks.push({ kind: "paragraph", content: parseInline(line) });
    i++;
  }
  return blocks;
}

const WORD = /[\p{L}\p{N}_]/u;
const SPACE = /\s/;
const MENTION_AT = new RegExp(
  `^@(${HANDLE_CHAR}{${HANDLE_MIN_LENGTH},${HANDLE_MAX_LENGTH}})(?!${HANDLE_CHAR})`,
  "i",
);
const HANDLE_CHAR_RE = new RegExp(HANDLE_CHAR, "i");
const URL_AT = /^https?:\/\/[^\s<>"'`]+/i;

const isWord = (ch: string | undefined) => ch !== undefined && WORD.test(ch);
const isSpace = (ch: string | undefined) => ch === undefined || SPACE.test(ch);

/** Trailing punctuation reads as the sentence's, not the URL's; a `)` stays if it closes one. */
function trimUrl(url: string): string {
  let end = url.length;
  while (end > 0) {
    const ch = url[end - 1] ?? "";
    if (/[.,;:!?'"\]}]/.test(ch)) {
      end--;
      continue;
    }
    if (ch === ")") {
      const body = url.slice(0, end);
      const open = body.split("(").length - 1;
      const close = body.split(")").length - 1;
      if (close > open) {
        end--;
        continue;
      }
    }
    break;
  }
  return url.slice(0, end);
}

/** Where a `**` or `~~` pair opened at `from` closes, or -1. */
function findDoubleClose(text: string, marker: string, from: number): number {
  for (let j = from; j + 1 < text.length; j++) {
    if (text.startsWith(marker, j) && !isSpace(text[j - 1])) return j;
  }
  return -1;
}

/** Where a single `*` closes, stepping over `**` pairs so nested bold does not end it. */
function findStarClose(text: string, from: number): number {
  for (let j = from; j < text.length; j++) {
    if (text[j] !== "*") continue;
    if (text[j + 1] === "*") {
      j++;
      continue;
    }
    if (!isSpace(text[j - 1])) return j;
  }
  return -1;
}

/** Where a `_` closes: after non-space and not followed by a word character (`snake_case`). */
function findUnderscoreClose(text: string, from: number): number {
  for (let j = from; j < text.length; j++) {
    if (text[j] === "_" && !isSpace(text[j - 1]) && !isWord(text[j + 1])) return j;
  }
  return -1;
}

/** One line of inline markup. */
export function parseInline(text: string): RichInline[] {
  const out: RichInline[] = [];
  let buffer = "";
  const flush = () => {
    if (buffer) out.push({ kind: "text", text: buffer });
    buffer = "";
  };
  const push = (node: RichInline) => {
    flush();
    out.push(node);
  };

  let i = 0;
  while (i < text.length) {
    const ch = text[i] ?? "";
    const prev = text[i - 1];
    const rest = text.slice(i);

    if (ch === "`") {
      let run = 0;
      while (text[i + run] === "`") run++;
      const fence = "`".repeat(run);
      let close = -1;
      for (let j = i + run; j < text.length; j++) {
        if (text.startsWith(fence, j) && text[j - 1] !== "`" && text[j + run] !== "`") {
          close = j;
          break;
        }
      }
      if (close > i + run) {
        let code = text.slice(i + run, close);
        if (code.length > 2 && code.startsWith(" ") && code.endsWith(" ") && code.trim()) {
          code = code.slice(1, -1);
        }
        push({ kind: "code", text: code });
        i = close + run;
        continue;
      }
      buffer += fence;
      i += run;
      continue;
    }

    if ((ch === "h" || ch === "H") && !isWord(prev)) {
      const match = URL_AT.exec(rest);
      const url = match ? trimUrl(match[0]) : "";
      if (/^https?:\/\/[^/]/i.test(url)) {
        push({ kind: "link", url });
        i += url.length;
        continue;
      }
    }

    if (ch === "@" && !(prev && HANDLE_CHAR_RE.test(prev))) {
      const match = MENTION_AT.exec(rest);
      if (match) {
        push({ kind: "mention", handle: (match[1] ?? "").toLowerCase() });
        i += match[0].length;
        continue;
      }
    }

    if ((rest.startsWith("**") || rest.startsWith("~~")) && !isSpace(text[i + 2])) {
      const marker = rest.slice(0, 2);
      const close = findDoubleClose(text, marker, i + 3);
      if (close !== -1) {
        push({
          kind: marker === "**" ? "bold" : "strike",
          children: parseInline(text.slice(i + 2, close)),
        });
        i = close + 2;
        continue;
      }
    }

    if (ch === "*" && text[i + 1] !== "*" && !isSpace(text[i + 1])) {
      const close = findStarClose(text, i + 2);
      if (close !== -1) {
        push({ kind: "italic", children: parseInline(text.slice(i + 1, close)) });
        i = close + 1;
        continue;
      }
    }

    if (ch === "_" && !isWord(prev) && text[i + 1] !== "_" && !isSpace(text[i + 1])) {
      const close = findUnderscoreClose(text, i + 2);
      if (close !== -1) {
        push({ kind: "italic", children: parseInline(text.slice(i + 1, close)) });
        i = close + 1;
        continue;
      }
    }

    buffer += ch;
    i++;
  }
  flush();
  return out;
}

/** A run of text with one set of formats: what an editor holds, and what `serializeSpans` writes. */
export interface RichSpan {
  text: string;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  code?: boolean;
}

/** Flattens inline nodes into formatted runs; mentions and links come back as their text. */
export function inlineToSpans(nodes: RichInline[], inherited: Omit<RichSpan, "text"> = {}) {
  const spans: RichSpan[] = [];
  for (const node of nodes) {
    switch (node.kind) {
      case "text":
        spans.push({ ...inherited, text: node.text });
        break;
      case "mention":
        spans.push({ ...inherited, text: `@${node.handle}` });
        break;
      case "link":
        spans.push({ ...inherited, text: node.url });
        break;
      case "code":
        spans.push({ ...inherited, code: true, text: node.text });
        break;
      default:
        spans.push(...inlineToSpans(node.children, { ...inherited, [node.kind]: true }));
    }
  }
  return spans;
}

/** Outermost first, so bold-italic is written `**_x_**`. */
const ORDER: RichFormat[] = ["bold", "italic", "strike"];

/**
 * Whether the italic run starting at span `s` has to be written `*`: `_` neither opens after a
 * word character nor closes before one (so `snake_case` stays literal), `*` can do both.
 */
function italicNeedsStar(spans: RichSpan[], s: number, before: string | undefined): boolean {
  if (isWord(before)) return true;
  // Walk the italic run; whitespace-only spans ride along with whatever is open.
  let k = s;
  let lastText = s;
  for (; k < spans.length; k++) {
    const span = spans[k];
    if (!span?.text) continue;
    const blank = !span.text.trim();
    if (!blank && (!span.italic || span.code)) break;
    if (!blank) lastText = k;
  }
  // The closer lands before any trailing whitespace, so whitespace there means it meets a space.
  const tail = spans
    .slice(lastText, k)
    .map((n) => n.text)
    .join("");
  if (/\s$/.test(tail)) return false;
  const next = spans.slice(k).find((n) => n.text);
  // A format the italic run lacks opens there, so the closer meets that marker, not a letter.
  const first = spans[s];
  if (next && (next.code || (next.bold && !first?.bold) || (next.strike && !first?.strike))) {
    return false;
  }
  return isWord(next?.text[0]);
}

/**
 * Writes one line of formatted runs as markup `parseInline` reads back to the same runs.
 * Markers hug the text: whitespace at a run's edge moves outside them, as the parser requires.
 */
export function serializeSpans(spans: RichSpan[]): string {
  let out = "";
  const open: RichFormat[] = [];
  const written: string[] = [];

  const closeTo = (depth: number) => {
    if (open.length <= depth) return;
    const trailing = /\s*$/.exec(out)?.[0] ?? "";
    out = out.slice(0, out.length - trailing.length);
    while (open.length > depth) {
      open.pop();
      out += written.pop() ?? "";
    }
    out += trailing;
  };

  for (let s = 0; s < spans.length; s++) {
    const span = spans[s];
    if (!span?.text) continue;

    if (span.code) {
      closeTo(0);
      const longest = Math.max(0, ...(span.text.match(/`+/g) ?? []).map((r) => r.length));
      const fence = "`".repeat(longest + 1);
      const pad = span.text.startsWith("`") || span.text.endsWith("`") ? " " : "";
      out += `${fence}${pad}${span.text}${pad}${fence}`;
      continue;
    }

    // Whitespace alone keeps whatever is open: closing and reopening around it changes nothing.
    if (!span.text.trim()) {
      out += span.text;
      continue;
    }

    const wanted = ORDER.filter((f) => span[f]);
    let keep = 0;
    while (keep < open.length && wanted.includes(open[keep] as RichFormat)) keep++;
    closeTo(keep);

    const toOpen = wanted.filter((f) => !open.includes(f));
    if (toOpen.length === 0) {
      out += span.text;
      continue;
    }
    const leading = /^\s*/.exec(span.text)?.[0] ?? "";
    out += leading;
    for (const format of toOpen) {
      const marker =
        format === "bold"
          ? "**"
          : format === "strike"
            ? "~~"
            : italicNeedsStar(spans, s, out.at(-1))
              ? "*"
              : "_";
      open.push(format);
      written.push(marker);
      out += marker;
    }
    out += span.text.slice(leading.length);
  }
  closeTo(0);
  return out;
}

/** The text without its markup, for search and anywhere formatting cannot show. */
export function richTextToPlain(source: string): string {
  const inline = (nodes: RichInline[]): string =>
    nodes
      .map((n) => {
        switch (n.kind) {
          case "text":
          case "code":
            return n.text;
          case "mention":
            return `@${n.handle}`;
          case "link":
            return n.url;
          default:
            return inline(n.children);
        }
      })
      .join("");
  return parseRichText(source)
    .map((block) => {
      switch (block.kind) {
        case "paragraph":
        case "heading":
          return inline(block.content);
        case "list":
          return block.items.map(inline).join("\n");
        case "quote":
          return block.lines.map(inline).join("\n");
        default:
          return block.text;
      }
    })
    .join("\n");
}
