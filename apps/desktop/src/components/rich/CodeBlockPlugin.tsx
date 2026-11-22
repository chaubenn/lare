import {
  type CodeEdit,
  closeBracketInCode,
  detectCodeLanguage,
  indentCode,
  leaveCodeOnEnter,
  newlineInCode,
  normalizeCodeLanguage,
  outdentCode,
} from "@lare/shared";
import { CODE_THEME_NAME } from "@lare/ui";
import { $createCodeHighlightNode, $createCodeNode, $isCodeNode, CodeNode } from "@lexical/code";
import { registerCodeHighlighting, ShikiTokenizer } from "@lexical/code-shiki";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { mergeRegister } from "@lexical/utils";
import {
  $createLineBreakNode,
  $createParagraphNode,
  $createRangeSelection,
  $getSelection,
  $insertNodes,
  $isRangeSelection,
  $isTextNode,
  $setSelection,
  COMMAND_PRIORITY_NORMAL,
  KEY_DOWN_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_TAB_COMMAND,
  type LexicalNode,
  PASTE_COMMAND,
  type PointType,
} from "lexical";
import { useEffect } from "react";

/** Code blocks without a language stay plain until one is picked or guessed. */
const TOKENIZER = { ...ShikiTokenizer, defaultLanguage: null, defaultTheme: CODE_THEME_NAME };

/**
 * Code blocks that behave like a code editor: Python, Java and C++ in the app's code colours, the
 * language guessed from the code until someone picks one, and indentation that follows the code
 * (Tab and Shift+Tab by four spaces, Enter carrying the indent and opening blocks, a closing
 * bracket lining up with its opener). Pasting code into an ordinary line makes it a code block.
 */
export function CodeBlockPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(
    () =>
      mergeRegister(
        registerCodeHighlighting(editor, TOKENIZER),
        editor.registerNodeTransform(CodeNode, (node) => {
          if (node.getLanguage()) return;
          const guess = detectCodeLanguage(node.getTextContent());
          if (guess) node.setLanguage(guess);
        }),
        editor.registerCommand(
          KEY_TAB_COMMAND,
          (event) => {
            const code = $codeSelection();
            if (!code) return false;
            event.preventDefault();
            const edit = event.shiftKey ? outdentCode : indentCode;
            $applyCodeEdit(code.node, edit(code.text, code.start, code.end));
            return true;
          },
          COMMAND_PRIORITY_NORMAL,
        ),
        editor.registerCommand(
          KEY_ENTER_COMMAND,
          (event) => {
            // Cmd/Ctrl+Enter submits; leave it to the editor's own handler.
            if (event && (event.metaKey || event.ctrlKey)) return false;
            const code = $codeSelection();
            if (!code) return false;
            event?.preventDefault();
            const kept = leaveCodeOnEnter(code.text, code.start, code.end);
            if (kept !== null) {
              $applyCodeEdit(code.node, { text: kept, start: kept.length, end: kept.length });
              const paragraph = $createParagraphNode();
              code.node.insertAfter(paragraph);
              paragraph.select();
              return true;
            }
            const language = code.node.getLanguage();
            $applyCodeEdit(
              code.node,
              newlineInCode(
                code.text,
                code.start,
                code.end,
                language ? normalizeCodeLanguage(language) : detectCodeLanguage(code.text),
              ),
            );
            return true;
          },
          COMMAND_PRIORITY_NORMAL,
        ),
        editor.registerCommand(
          KEY_DOWN_COMMAND,
          (event) => {
            if (!CLOSERS.has(event.key) || event.metaKey || event.ctrlKey || event.altKey) {
              return false;
            }
            const code = $codeSelection();
            if (!code) return false;
            const edit = closeBracketInCode(code.text, code.start, code.end, event.key);
            if (!edit) return false;
            event.preventDefault();
            $applyCodeEdit(code.node, edit);
            return true;
          },
          COMMAND_PRIORITY_NORMAL,
        ),
        editor.registerCommand(
          PASTE_COMMAND,
          (event) => {
            if (!(event instanceof ClipboardEvent)) return false;
            const text = (event.clipboardData?.getData("text/plain") ?? "").replace(/\r\n?/g, "\n");
            const selection = $getSelection();
            if (!text || !$isRangeSelection(selection)) return false;
            if ($codeSelection()) {
              // Into a code block it is the code, whatever formatting the source copied with.
              event.preventDefault();
              selection.insertRawText(text);
              return true;
            }
            const language = text.includes("\n") ? detectCodeLanguage(text) : null;
            if (!language) return false;
            event.preventDefault();
            $insertNodes([
              $createCodeNode(language).append(...$codeLines(text.replace(/\n+$/, ""))),
            ]);
            return true;
          },
          COMMAND_PRIORITY_NORMAL,
        ),
      ),
    [editor],
  );

  return null;
}

const CLOSERS = new Set(["}", "]", ")"]);

interface CodeSelection {
  node: CodeNode;
  text: string;
  start: number;
  end: number;
}

function $codeOf(node: LexicalNode): CodeNode | null {
  if ($isCodeNode(node)) return node;
  const parent = node.getParent();
  return $isCodeNode(parent) ? parent : null;
}

/** The selection as offsets into one code block's text, or null when it is not inside one. */
function $codeSelection(): CodeSelection | null {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return null;
  const node = $codeOf(selection.anchor.getNode());
  const other = $codeOf(selection.focus.getNode());
  if (!node || !other || !node.is(other)) return null;
  const a = $offsetIn(node, selection.anchor);
  const f = $offsetIn(node, selection.focus);
  return { node, text: node.getTextContent(), start: Math.min(a, f), end: Math.max(a, f) };
}

function $offsetIn(code: CodeNode, point: PointType): number {
  const children = code.getChildren();
  if (point.type === "element" && point.key === code.getKey()) {
    return children.slice(0, point.offset).reduce((n, c) => n + c.getTextContentSize(), 0);
  }
  let offset = 0;
  for (const child of children) {
    if (child.getKey() === point.key) return offset + point.offset;
    offset += child.getTextContentSize();
  }
  return offset;
}

/** A block's text as the flat line structure a code node holds. */
function $codeLines(text: string): LexicalNode[] {
  return text
    .split("\n")
    .flatMap((line, i) => [
      ...(i > 0 ? [$createLineBreakNode()] : []),
      ...(line ? [$createCodeHighlightNode(line)] : []),
    ]);
}

/** Replaces a block's text and puts the selection where the edit says. The highlighter then
 * re-colours it, keeping the selection in place. */
function $applyCodeEdit(code: CodeNode, edit: CodeEdit) {
  code.clear();
  code.append(...$codeLines(edit.text));
  const selection = $createRangeSelection();
  const anchor = $pointAt(code, edit.start);
  const focus = $pointAt(code, edit.end);
  selection.anchor.set(anchor.key, anchor.offset, anchor.type);
  selection.focus.set(focus.key, focus.offset, focus.type);
  $setSelection(selection);
}

function $pointAt(code: CodeNode, offset: number) {
  let pos = 0;
  const children = code.getChildren();
  for (const [index, child] of children.entries()) {
    const size = child.getTextContentSize();
    if ($isTextNode(child) && offset <= pos + size) {
      return { key: child.getKey(), offset: offset - pos, type: "text" as const };
    }
    if (offset === pos) return { key: code.getKey(), offset: index, type: "element" as const };
    pos += size;
  }
  return { key: code.getKey(), offset: children.length, type: "element" as const };
}
