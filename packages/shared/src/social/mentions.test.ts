import { describe, expect, it } from "vitest";
import { insertMention, mentionAtCaret, splitMentions } from "./mentions";

describe("splitMentions", () => {
  it("finds mentions between text", () => {
    expect(splitMentions("thanks @Alice_1, and @bob!")).toEqual([
      { kind: "text", text: "thanks " },
      { kind: "mention", handle: "alice_1" },
      { kind: "text", text: ", and " },
      { kind: "mention", handle: "bob" },
      { kind: "text", text: "!" },
    ]);
  });

  it("ignores emails, too-short handles and bare @", () => {
    expect(splitMentions("mail me@example.com or @al or @")).toEqual([
      { kind: "text", text: "mail me@example.com or @al or @" },
    ]);
  });

  it("handles a mention at the start and back to back", () => {
    expect(splitMentions("@ann @ben")).toEqual([
      { kind: "mention", handle: "ann" },
      { kind: "text", text: " " },
      { kind: "mention", handle: "ben" },
    ]);
  });
});

describe("mentionAtCaret", () => {
  it("returns the partial handle being typed", () => {
    expect(mentionAtCaret("hi @Bo", 6)).toEqual({ start: 3, query: "bo" });
    expect(mentionAtCaret("@", 1)).toEqual({ start: 0, query: "" });
  });

  it("is null outside a mention", () => {
    expect(mentionAtCaret("me@ex", 5)).toBeNull();
    expect(mentionAtCaret("@bob done", 9)).toBeNull();
  });
});

describe("insertMention", () => {
  it("completes the handle and moves the caret past it", () => {
    const text = "hey @bo there";
    const mention = mentionAtCaret(text, 7);
    expect(mention).not.toBeNull();
    if (!mention) return;
    expect(insertMention(text, mention, "bob")).toEqual({ text: "hey @bob there", caret: 9 });
  });
});
