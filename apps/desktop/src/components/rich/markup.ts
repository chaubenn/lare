/**
 * Moves text between the stored markup (`@lare/shared` rich text) and a Lexical editor's tree.
 * Both run inside an editor read or update, hence the `$` names Lexical uses for that.
 */

import {
  inlineToSpans,
  normalizeCodeLanguage,
  parseRichText,
  type RichInline,
  type RichSpan,
  serializeSpans,
} from "@lare/shared";
import { $createCodeNode, $isCodeNode, CodeHighlightNode, CodeNode } from "@lexical/code";
import { $isAutoLinkNode, $isLinkNode, AutoLinkNode, LinkNode } from "@lexical/link";
import {
  $createListItemNode,
  $createListNode,
  $isListItemNode,
  $isListNode,
  ListItemNode,
  ListNode,
} from "@lexical/list";
import {
  $createHeadingNode,
  $createQuoteNode,
  $isHeadingNode,
  $isQuoteNode,
  HeadingNode,
  QuoteNode,
} from "@lexical/rich-text";
import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isElementNode,
  $isLineBreakNode,
  $isTextNode,
  type ElementNode,
  type LexicalNode,
} from "lexical";

/** The node types the editor needs registered to hold everything the markup can say. */
export const RICH_TEXT_NODES = [
  ListNode,
  ListItemNode,
  QuoteNode,
  HeadingNode,
  CodeNode,
  CodeHighlightNode,
  LinkNode,
  AutoLinkNode,
];

/** Replaces the editor's content with `source`. */
export function $setMarkup(source: string): void {
  const root = $getRoot();
  root.clear();
  for (const block of parseRichText(source)) {
    switch (block.kind) {
      case "paragraph":
        root.append($createParagraphNode().append(...$inline(block.content)));
        break;
      case "heading":
        root.append($createHeadingNode(`h${block.level}`).append(...$inline(block.content)));
        break;
      case "list": {
        const list = $createListNode(block.ordered ? "number" : "bullet", block.start);
        for (const item of block.items) list.append($createListItemNode().append(...$inline(item)));
        root.append(list);
        break;
      }
      case "quote":
        root.append($createQuoteNode().append(...$lines(block.lines.map($inline))));
        break;
      case "code":
        root.append(
          $createCodeNode(block.language ?? undefined).append(
            ...$lines(block.text.split("\n").map((line) => (line ? [$createTextNode(line)] : []))),
          ),
        );
        break;
    }
  }
  if (root.getChildrenSize() === 0) root.append($createParagraphNode());
}

function $inline(nodes: RichInline[]): LexicalNode[] {
  return inlineToSpans(nodes).map((span) => {
    const node = $createTextNode(span.text);
    if (span.bold) node.toggleFormat("bold");
    if (span.italic) node.toggleFormat("italic");
    if (span.strike) node.toggleFormat("strikethrough");
    if (span.code) node.toggleFormat("code");
    return node;
  });
}

/** Lines joined by line breaks, as quotes and code blocks hold them. */
function $lines(lines: LexicalNode[][]): LexicalNode[] {
  return lines.flatMap((line, i) => (i === 0 ? line : [$createLineBreakNode(), ...line]));
}

/** The editor's content as markup. */
export function $getMarkup(): string {
  const lines: string[] = [];
  for (const block of $getRoot().getChildren()) lines.push(...$blockLines(block));
  return lines.join("\n");
}

function $blockLines(block: LexicalNode): string[] {
  if ($isListNode(block)) {
    const ordered = block.getListType() === "number";
    let n = block.getStart();
    return $listItems(block).map((item) => {
      const marker = ordered ? `${n++}. ` : "- ";
      return marker + $spanLines(item).join(" ");
    });
  }
  if ($isQuoteNode(block)) return $spanLines(block).map((line) => (line ? `> ${line}` : ">"));
  if ($isHeadingNode(block)) {
    const level = Number(block.getTag().slice(1));
    // Past h3 (a pasted h4) still reads as a heading, at the smallest size the markup has.
    return [`${"#".repeat(Math.min(level, 3))} ${$spanLines(block).join(" ")}`];
  }
  if ($isCodeNode(block)) {
    const language = block.getLanguage();
    return [
      `\`\`\`${language ? normalizeCodeLanguage(language) : ""}`,
      ...block.getTextContent().split("\n"),
      "```",
    ];
  }
  if ($isElementNode(block)) return $spanLines(block);
  return [block.getTextContent()];
}

/** A list's items in order, nested lists flattened in: the markup has one level. */
function $listItems(list: ListNode): ElementNode[] {
  const items: ElementNode[] = [];
  for (const child of list.getChildren()) {
    if (!$isListItemNode(child)) continue;
    const nested = child.getChildren().filter($isListNode);
    if (nested.length > 0) for (const inner of nested) items.push(...$listItems(inner));
    else items.push(child);
  }
  return items;
}

/** An element's inline content, split into lines at its line breaks. */
function $spanLines(element: ElementNode): string[] {
  const lines: RichSpan[][] = [[]];
  const walk = (node: LexicalNode) => {
    if ($isLineBreakNode(node)) {
      lines.push([]);
    } else if ($isTextNode(node)) {
      lines.at(-1)?.push({
        text: node.getTextContent(),
        bold: node.hasFormat("bold"),
        italic: node.hasFormat("italic"),
        strike: node.hasFormat("strikethrough"),
        code: node.hasFormat("code"),
      });
    } else if ($isLinkNode(node) && !$isAutoLinkNode(node)) {
      // The markup only links bare URLs, so a pasted link keeps its text and gains the address.
      for (const child of node.getChildren()) walk(child);
      const url = node.getURL();
      if (/^https?:\/\//i.test(url) && node.getTextContent() !== url) {
        lines.at(-1)?.push({ text: ` (${url})` });
      }
    } else if ($isElementNode(node)) {
      for (const child of node.getChildren()) walk(child);
    } else {
      lines.at(-1)?.push({ text: node.getTextContent() });
    }
  };
  for (const child of element.getChildren()) walk(child);
  return lines.map(serializeSpans);
}
