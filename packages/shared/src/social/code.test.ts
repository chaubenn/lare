import { describe, expect, it } from "vitest";
import {
  closeBracketInCode,
  detectCodeLanguage,
  indentCode,
  leaveCodeOnEnter,
  newlineInCode,
  normalizeCodeLanguage,
  outdentCode,
} from "./code";

/** `|` marks the caret, `[` `]` a selection. */
function at(marked: string) {
  const caret = marked.indexOf("|");
  if (caret !== -1) return { text: marked.replace("|", ""), start: caret, end: caret };
  const start = marked.indexOf("[");
  const end = marked.indexOf("]") - 1;
  return { text: marked.replace("[", "").replace("]", ""), start, end };
}
function mark(edit: { text: string; start: number; end: number }) {
  const { text, start, end } = edit;
  return start === end
    ? `${text.slice(0, start)}|${text.slice(start)}`
    : `${text.slice(0, start)}[${text.slice(start, end)}]${text.slice(end)}`;
}

describe("normalizeCodeLanguage", () => {
  it("maps the usual spellings", () => {
    expect(normalizeCodeLanguage("py")).toBe("python");
    expect(normalizeCodeLanguage("C++")).toBe("cpp");
    expect(normalizeCodeLanguage("Java")).toBe("java");
    expect(normalizeCodeLanguage("txt")).toBe("text");
    expect(normalizeCodeLanguage("rust")).toBe("rust");
  });
});

describe("detectCodeLanguage", () => {
  it("recognises LeetCode-style solutions", () => {
    expect(
      detectCodeLanguage(
        "class Solution:\n    def twoSum(self, nums: List[int], target: int) -> List[int]:\n        seen = {}",
      ),
    ).toBe("python");
    expect(
      detectCodeLanguage(
        "class Solution {\n    public int[] twoSum(int[] nums, int target) {\n        Map<Integer, Integer> seen = new HashMap<>();",
      ),
    ).toBe("java");
    expect(
      detectCodeLanguage(
        "class Solution {\npublic:\n    vector<int> twoSum(vector<int>& nums, int target) {\n        unordered_map<int, int> seen;",
      ),
    ).toBe("cpp");
  });

  it("leaves prose and unknown code alone", () => {
    expect(detectCodeLanguage("just some notes")).toBeNull();
    expect(detectCodeLanguage("SELECT * FROM users;")).toBeNull();
  });
});

describe("indentCode", () => {
  it("pads a caret to the next indent stop", () => {
    expect(mark(indentCode(...args(at("ab|c"))))).toBe("ab  |c");
    expect(mark(indentCode(...args(at("|x"))))).toBe("    |x");
  });

  it("indents every selected line", () => {
    expect(mark(indentCode(...args(at("[a\nb]\nc"))))).toBe("[    a\n    b]\nc");
    // A selection ending at a line start leaves that line alone.
    expect(mark(indentCode(...args(at("a[b\n]c"))))).toBe("    a[b\n]c");
  });
});

describe("outdentCode", () => {
  it("takes one level off each touched line", () => {
    expect(mark(outdentCode(...args(at("      a|"))))).toBe("  a|");
    expect(mark(outdentCode(...args(at("[    a\n\tb\nc]"))))).toBe("[a\nb\nc]");
  });
});

describe("newlineInCode", () => {
  it("keeps the indent", () => {
    expect(mark(newlineInCode(...args(at("    x = 1|")), "python"))).toBe("    x = 1\n    |");
  });

  it("goes one deeper after a Python colon", () => {
    expect(mark(newlineInCode(...args(at("def f():|")), "python"))).toBe("def f():\n    |");
  });

  it("opens braces onto their own lines", () => {
    expect(mark(newlineInCode(...args(at("int f() {|}")), "java"))).toBe("int f() {\n    |\n}");
    expect(mark(newlineInCode(...args(at("  if (x) {|")), "cpp"))).toBe("  if (x) {\n      |");
  });
});

describe("closeBracketInCode", () => {
  it("pulls a lone closing brace back a level", () => {
    expect(mark(closeBracketInCode(...args(at("{\n        |")), "}") ?? at(""))).toBe("{\n    }|");
  });

  it("types normally after other text", () => {
    expect(closeBracketInCode(...args(at("x = {|")), "}")).toBeNull();
  });
});

describe("leaveCodeOnEnter", () => {
  it("leaves after two blank lines at the end", () => {
    expect(leaveCodeOnEnter(...args(at("x = 1\n    \n    |")))).toBe("x = 1");
    expect(leaveCodeOnEnter(...args(at("x = 1\n|")))).toBeNull();
    expect(leaveCodeOnEnter(...args(at("x\n\n|y")))).toBeNull();
  });
});

function args(edit: { text: string; start: number; end: number }) {
  return [edit.text, edit.start, edit.end] as const;
}
