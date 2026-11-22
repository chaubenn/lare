import { describe, expect, it } from "vitest";
import {
  inlineToSpans,
  parseInline,
  parseRichText,
  type RichSpan,
  richTextToPlain,
  serializeSpans,
} from "./richText";

/** Markup → runs → markup, as the editor does on every load and save. */
const roundTrip = (line: string) => serializeSpans(inlineToSpans(parseInline(line)));

/** Runs → markup → runs, merging neighbours with the same formats as an editor would. */
function spansBack(spans: RichSpan[]): RichSpan[] {
  const merged: RichSpan[] = [];
  for (const span of inlineToSpans(parseInline(serializeSpans(spans)))) {
    const last = merged.at(-1);
    const same = (s: RichSpan) => `${!!s.bold}${!!s.italic}${!!s.strike}${!!s.code}`;
    if (last && same(last) === same(span)) last.text += span.text;
    else merged.push({ ...span });
  }
  return merged.map((s) =>
    Object.fromEntries(Object.entries(s).filter(([, v]) => v !== false && v !== undefined)),
  ) as RichSpan[];
}

describe("parseInline", () => {
  it("reads bold, italic, strike and code", () => {
    expect(parseInline("**b** _i_ *j* ~~s~~ `c`")).toEqual([
      { kind: "bold", children: [{ kind: "text", text: "b" }] },
      { kind: "text", text: " " },
      { kind: "italic", children: [{ kind: "text", text: "i" }] },
      { kind: "text", text: " " },
      { kind: "italic", children: [{ kind: "text", text: "j" }] },
      { kind: "text", text: " " },
      { kind: "strike", children: [{ kind: "text", text: "s" }] },
      { kind: "text", text: " " },
      { kind: "code", text: "c" },
    ]);
  });

  it("leaves plain text that only looks like markup alone", () => {
    for (const text of [
      "snake_case_name and __init__",
      "2 * 3 * 4",
      "a ** b ** c",
      "unclosed **bold and `code",
      "price: $5_000",
    ]) {
      expect(parseInline(text)).toEqual([{ kind: "text", text }]);
    }
  });

  it("keeps mentions whole, underscores and all", () => {
    expect(parseInline("ping @foo_bar_ and @_x_y_")).toEqual([
      { kind: "text", text: "ping " },
      { kind: "mention", handle: "foo_bar_" },
      { kind: "text", text: " and " },
      { kind: "mention", handle: "_x_y_" },
    ]);
    expect(parseInline("me@example.com")).toEqual([{ kind: "text", text: "me@example.com" }]);
  });

  it("links bare URLs without their trailing punctuation", () => {
    expect(parseInline("see https://a.com/x_(y)_*z*. or (http://b.io)")).toEqual([
      { kind: "text", text: "see " },
      { kind: "link", url: "https://a.com/x_(y)_*z*" },
      { kind: "text", text: ". or (" },
      { kind: "link", url: "http://b.io" },
      { kind: "text", text: ")" },
    ]);
  });

  it("only links http and https", () => {
    expect(parseInline("javascript:alert(1) ftp://x")).toEqual([
      { kind: "text", text: "javascript:alert(1) ftp://x" },
    ]);
  });

  it("nests formats", () => {
    expect(parseInline("**a _b_ c**")).toEqual([
      {
        kind: "bold",
        children: [
          { kind: "text", text: "a " },
          { kind: "italic", children: [{ kind: "text", text: "b" }] },
          { kind: "text", text: " c" },
        ],
      },
    ]);
  });

  it("reads code spans fenced with more backticks", () => {
    expect(parseInline("`` a`b ``")).toEqual([{ kind: "code", text: "a`b" }]);
  });
});

describe("parseRichText", () => {
  it("reads lists, quotes and fenced code by line", () => {
    expect(parseRichText("intro\n- a\n- b\n3. c\n4. d\n> q\n```\nx  y\n```\n")).toEqual([
      { kind: "paragraph", content: [{ kind: "text", text: "intro" }] },
      {
        kind: "list",
        ordered: false,
        start: 1,
        items: [[{ kind: "text", text: "a" }], [{ kind: "text", text: "b" }]],
      },
      {
        kind: "list",
        ordered: true,
        start: 3,
        items: [[{ kind: "text", text: "c" }], [{ kind: "text", text: "d" }]],
      },
      { kind: "quote", lines: [[{ kind: "text", text: "q" }]] },
      { kind: "code", text: "x  y", language: null },
      { kind: "paragraph", content: [] },
    ]);
  });

  it("reads headings up to level three and fence languages", () => {
    expect(parseRichText("# One\n### Three\n#### four\n#no space\n```py\nx\n```")).toEqual([
      { kind: "heading", level: 1, content: [{ kind: "text", text: "One" }] },
      { kind: "heading", level: 3, content: [{ kind: "text", text: "Three" }] },
      { kind: "paragraph", content: [{ kind: "text", text: "#### four" }] },
      { kind: "paragraph", content: [{ kind: "text", text: "#no space" }] },
      { kind: "code", text: "x", language: "python" },
    ]);
  });

  it("keeps every line of old plain text, blank ones included", () => {
    expect(parseRichText("one\n\ntwo").map((b) => b.kind)).toEqual([
      "paragraph",
      "paragraph",
      "paragraph",
    ]);
  });

  it("does not treat formatting inside a code block", () => {
    expect(parseRichText("```\n**x** @someone")).toEqual([
      { kind: "code", text: "**x** @someone", language: null },
    ]);
  });
});

describe("serializeSpans", () => {
  it("writes runs the parser reads back unchanged", () => {
    const cases: RichSpan[][] = [
      [{ text: "plain" }],
      [{ text: "a " }, { text: "bold", bold: true }, { text: " b" }],
      [{ text: "bold ", bold: true }, { text: "both", bold: true, italic: true }, { text: " end" }],
      [
        { text: "x", italic: true },
        { text: "y", bold: true },
      ],
      [{ text: "foo" }, { text: "bar", italic: true }, { text: "baz" }],
      [{ text: "struck", strike: true }, { text: " and " }, { text: "a`b", code: true }],
      [{ text: "edge", bold: true }, { text: " next" }],
      [{ text: "all", bold: true, italic: true, strike: true }],
    ];
    for (const spans of cases) expect(spansBack(spans)).toEqual(spans);
  });

  it("moves edge whitespace outside the markers", () => {
    expect(serializeSpans([{ text: "a" }, { text: " b ", bold: true }, { text: "c" }])).toBe(
      "a **b** c",
    );
  });

  it("leaves markup that already round-trips as it was", () => {
    for (const line of ["**b** and _i_", "hi @foo_bar, see https://x.com/a_b", "`code` x"]) {
      expect(roundTrip(line)).toBe(line);
    }
  });
});

describe("richTextToPlain", () => {
  it("drops the markup", () => {
    expect(richTextToPlain("**Two** _sum_\n- `map`\n> ok")).toBe("Two sum\nmap\nok");
  });
});
