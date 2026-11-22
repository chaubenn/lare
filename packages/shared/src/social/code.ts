/**
 * Code blocks in write-ups and comments: which languages get colour, guessing one from the code
 * when nobody picked, and the editor's indentation rules. The editing helpers are pure string
 * operations over the block's text and selection, so they can be tested without an editor.
 */

/** The languages a code block can be set to, in menu order. */
export const CODE_LANGUAGES = [
  { id: "python", label: "Python" },
  { id: "java", label: "Java" },
  { id: "cpp", label: "C++" },
] as const;

export type CodeLanguage = (typeof CODE_LANGUAGES)[number]["id"];

/** A block someone set to plain text on purpose, so it is never guessed at. */
export const PLAIN_CODE = "text";

const ALIASES: Record<string, string> = {
  py: "python",
  py3: "python",
  python3: "python",
  "c++": "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  txt: PLAIN_CODE,
  plain: PLAIN_CODE,
  plaintext: PLAIN_CODE,
};

/** The canonical name for what was written after a fence (` ```py ` is Python). */
export function normalizeCodeLanguage(raw: string): string {
  const lower = raw.trim().toLowerCase();
  return ALIASES[lower] ?? lower;
}

export function isCodeLanguage(language: string | null | undefined): language is CodeLanguage {
  return CODE_LANGUAGES.some((l) => l.id === language);
}

const CPP = [
  /#include\s*[<"]/,
  /\bstd::/,
  /\b(cout|cin)\s*(<<|>>)/,
  /\b(vector|unordered_map|unordered_set|pair)\s*</,
  /^\s*public:\s*$/m,
  /\bnullptr\b/,
  /\w->\w/,
];
const JAVA = [
  /\b(public|private|protected)\s+(static\s+)?(final\s+)?(class|interface|void|int|long|boolean|String|double|char|[A-Z]\w*(<[^>]*>)?(\[\])*)\s/,
  /\bSystem\.out\./,
  /\bnew\s+[A-Z]\w*\s*(<[^>]*>)?\s*[([]/,
  /^\s*import\s+java\./m,
  /\bString\[\]/,
];
const PYTHON = [
  /^\s*def\s+\w+\s*\(.*\)\s*(->.*)?:\s*$/m,
  /^\s*class\s+\w+\s*(\(.*\))?:\s*$/m,
  /^\s*(from\s+[\w.]+\s+)?import\s+[\w.]+(\s+as\s+\w+)?\s*$/m,
  /^\s*(if|elif|for|while|with|try|except)\b.*:\s*$/m,
  /\bself\./,
  /\bprint\(/,
];

const score = (code: string, rules: RegExp[]) => rules.filter((r) => r.test(code)).length;

/**
 * A best guess at the language of some code, or null when nothing points anywhere. Only used
 * where nobody picked one: a block someone set stays as they set it.
 */
export function detectCodeLanguage(code: string): CodeLanguage | null {
  const scores: [CodeLanguage, number][] = [
    ["cpp", score(code, CPP)],
    ["java", score(code, JAVA)],
    ["python", score(code, PYTHON)],
  ];
  // A C++ LeetCode solution has `public:` and a Java one has `public int`: both are classes, so
  // the more specific signs win ties in the order above.
  let best: [CodeLanguage, number] | null = null;
  for (const entry of scores) if (entry[1] > 0 && (!best || entry[1] > best[1])) best = entry;
  return best?.[0] ?? null;
}

/** One indent level. Spaces, always: tabs mixed into Python are an error. */
export const INDENT = "    ";

export interface CodeEdit {
  text: string;
  /** The selection after the edit, as offsets into `text`. */
  start: number;
  end: number;
}

const lineStart = (text: string, at: number) => text.lastIndexOf("\n", at - 1) + 1;

/** Start offsets of every line the selection touches. A selection ending at a line's very start
 * does not touch that line, as in any code editor. */
function touchedLines(text: string, start: number, end: number): number[] {
  const last = end > start && lineStart(text, end) === end ? end - 1 : end;
  const starts: number[] = [];
  for (let at = lineStart(text, start); at <= last; ) {
    starts.push(at);
    const next = text.indexOf("\n", at);
    if (next === -1) break;
    at = next + 1;
  }
  return starts;
}

/** Shifts an offset for an edit that replaced `[at, at + removed)` with `added` characters. */
const shift = (offset: number, at: number, removed: number, added: number) =>
  offset <= at ? offset : Math.max(at + added, offset - removed + added);

/**
 * Tab. With a caret, spaces up to the next indent stop; with a selection, every touched line
 * moves right one level.
 */
export function indentCode(text: string, start: number, end: number): CodeEdit {
  if (start === end) {
    const column = start - lineStart(text, start);
    const pad = " ".repeat(INDENT.length - (column % INDENT.length));
    return {
      text: text.slice(0, start) + pad + text.slice(end),
      start: start + pad.length,
      end: start + pad.length,
    };
  }
  let next = text;
  let s = start;
  let e = end;
  for (const at of touchedLines(text, start, end).reverse()) {
    next = next.slice(0, at) + INDENT + next.slice(at);
    s = shift(s, at, 0, INDENT.length);
    e = shift(e, at, 0, INDENT.length);
    // A selection starting exactly at a line start keeps covering that line's new indent.
    if (start === at) s = at;
  }
  return { text: next, start: s, end: e };
}

/** Shift+Tab: every touched line moves left one level (up to four spaces, or one tab). */
export function outdentCode(text: string, start: number, end: number): CodeEdit {
  let next = text;
  let s = start;
  let e = end;
  for (const at of touchedLines(text, start, end).reverse()) {
    const lead = /^( {1,4}|\t)/.exec(next.slice(at))?.[0] ?? "";
    if (!lead) continue;
    next = next.slice(0, at) + next.slice(at + lead.length);
    s = shift(s, at, lead.length, 0);
    e = shift(e, at, lead.length, 0);
  }
  return { text: next, start: s, end: e };
}

/**
 * Enter: the new line keeps the indent of the one it left, and goes one deeper after a line that
 * opens a block (`:` in Python, `{` elsewhere). Between `{` and `}` the closing brace drops to its
 * own line at the outer indent, as editors do.
 */
export function newlineInCode(
  text: string,
  start: number,
  end: number,
  language: string | null,
): CodeEdit {
  const from = lineStart(text, start);
  const before = text.slice(from, start);
  const indent = /^[ \t]*/.exec(before)?.[0] ?? "";
  const trimmed = before.trimEnd();
  const opensBlock = language === "python" ? trimmed.endsWith(":") : /[{[(]$/.test(trimmed);
  const after = text.slice(end);
  const closes = opensBlock && language !== "python" && /^[ \t]*[}\])]/.test(after);

  const inner = `\n${indent}${opensBlock ? INDENT : ""}`;
  const tail = closes ? `\n${indent}${after.replace(/^[ \t]*/, "")}` : after;
  const head = text.slice(0, start);
  const caret = head.length + inner.length;
  return { text: head + inner + tail, start: caret, end: caret };
}

/**
 * Typing a closing bracket on a line of nothing but indent pulls the line back one level, so
 * `}` lines up with the line that opened it. Null when the character should just be typed.
 */
export function closeBracketInCode(
  text: string,
  start: number,
  end: number,
  bracket: string,
): CodeEdit | null {
  if (start !== end) return null;
  const from = lineStart(text, start);
  const before = text.slice(from, start);
  if (!before || /[^ \t]/.test(before)) return null;
  const kept = before.endsWith("\t")
    ? before.slice(0, -1)
    : before.slice(0, Math.max(0, before.length - INDENT.length));
  const head = text.slice(0, from) + kept + bracket;
  return { text: head + text.slice(end), start: head.length, end: head.length };
}

/**
 * Enter on a blank last line, after another blank line, leaves the block: the blank lines go and
 * the caret moves to a new paragraph below. Blank counts indent-only, since Enter carries the
 * indent down. Returns the block's text without them, or null to stay in the block.
 */
export function leaveCodeOnEnter(text: string, start: number, end: number): string | null {
  if (start !== end || start !== text.length) return null;
  const blank = /\n[ \t]*\n[ \t]*$/.exec(text);
  return blank ? text.slice(0, blank.index) : null;
}
