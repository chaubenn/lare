import { CODE_LANGUAGES, mentionAtCaret, normalizeCodeLanguage, PLAIN_CODE } from "@lare/shared";
import { cn } from "@lare/ui";
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  List,
  ListOrdered,
  Quote,
  SquareCode,
  Strikethrough,
} from "@lare/ui/icons";
import { Avatar } from "@lare/ui/primitives";
import { $createCodeNode, $isCodeNode } from "@lexical/code";
import {
  $isListNode,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  ListNode,
  REMOVE_LIST_COMMAND,
} from "@lexical/list";
import {
  BOLD_STAR,
  CODE,
  type ElementTransformer,
  HEADING,
  INLINE_CODE,
  ITALIC_STAR,
  ORDERED_LIST,
  QUOTE,
  STRIKETHROUGH,
  UNORDERED_LIST,
} from "@lexical/markdown";
import { AutoFocusPlugin } from "@lexical/react/LexicalAutoFocusPlugin";
import { AutoLinkPlugin, createLinkMatcherWithRegExp } from "@lexical/react/LexicalAutoLinkPlugin";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import {
  $createHeadingNode,
  $createQuoteNode,
  $isHeadingNode,
  $isQuoteNode,
} from "@lexical/rich-text";
import { $setBlocksType } from "@lexical/selection";
import { $getNearestNodeOfType, mergeRegister } from "@lexical/utils";
import {
  $createParagraphNode,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $isRootOrShadowRoot,
  $isTextNode,
  COMMAND_PRIORITY_HIGH,
  COMMAND_PRIORITY_LOW,
  FORMAT_TEXT_COMMAND,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  KEY_TAB_COMMAND,
  type LexicalEditor,
  type TextFormatType,
} from "lexical";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { useMentionSuggestions } from "@/features/publishing/posts/social";
import { CodeBlockPlugin } from "./CodeBlockPlugin";
import { KeepInViewPlugin } from "./KeepInViewPlugin";
import { $getMarkup, $setMarkup, RICH_TEXT_NODES } from "./markup";
import { EDITOR_THEME } from "./styles";

/** `#`, `##` or `###` and a space start a heading; the markup stops at three levels. */
const HEADING_SHORTCUT: ElementTransformer = { ...HEADING, regExp: /^(#{1,3})\s/ };

/** Typing these turns into formatting as you go. `_` is left out so `snake_case` stays text. */
const SHORTCUTS = [
  HEADING_SHORTCUT,
  UNORDERED_LIST,
  ORDERED_LIST,
  QUOTE,
  CODE,
  INLINE_CODE,
  BOLD_STAR,
  ITALIC_STAR,
  STRIKETHROUGH,
];

/** The formats the stored markup can hold; Cmd+U and friends would only be lost on save. */
const KEPT_FORMATS: TextFormatType[] = ["bold", "italic", "strikethrough", "code"];

const URL_MATCHERS = [
  createLinkMatcherWithRegExp(/https?:\/\/[^\s<>"'`]+[^\s<>"'`.,;:!?)\]}]/i, (text) => text),
];

/**
 * A formatted-text box for write-ups and comments. The value is markup (`@lare/shared` rich
 * text), so callers store and validate it as the plain string they always had. With `mentions`,
 * typing `@` offers people, as the comment box always did.
 */
export function RichTextEditor({
  value,
  onValueChange,
  id,
  placeholder,
  ariaLabel,
  mentions = false,
  autoFocus = false,
  onSubmitShortcut,
  onEscape,
  className,
  minHeight = "min-h-24",
  maxHeight = "max-h-[min(55vh,36rem)]",
}: {
  value: string;
  onValueChange: (value: string) => void;
  id?: string;
  placeholder?: string;
  ariaLabel: string;
  mentions?: boolean;
  autoFocus?: boolean;
  /** Cmd/Ctrl+Enter. */
  onSubmitShortcut?: () => void;
  onEscape?: () => void;
  className?: string;
  minHeight?: string;
  /** The text area scrolls inside itself past this, so the whole editor stays on screen. */
  maxHeight?: string;
}) {
  const namespace = useId();
  return (
    <LexicalComposer
      initialConfig={{
        namespace,
        nodes: RICH_TEXT_NODES,
        theme: EDITOR_THEME,
        editorState: () => $setMarkup(value),
        onError: (error) => {
          throw error;
        },
      }}
    >
      <div
        data-rich-editor
        className={cn(
          "relative w-full rounded-[var(--lare-r-2)] border border-[var(--input-border)] bg-[var(--surface-raised)] text-sm text-[var(--text)]",
          "focus-within:border-[var(--text-tertiary)] focus-within:ring-2 focus-within:ring-[var(--focus)]",
          className,
        )}
      >
        <Toolbar />
        <div className="relative">
          <RichTextPlugin
            contentEditable={
              <ContentEditable
                id={id}
                aria-label={ariaLabel}
                aria-multiline
                // The app's global focus ring is unlayered, so a utility class can't turn it off;
                // the whole box shows focus instead, as a textarea does.
                style={{ boxShadow: "none", caretColor: "var(--text)" }}
                className={cn(
                  "select-text space-y-0 overflow-y-auto overscroll-contain px-3 py-2 leading-relaxed outline-none",
                  minHeight,
                  maxHeight,
                )}
                aria-placeholder={placeholder ?? ""}
                placeholder={
                  <div className="pointer-events-none absolute top-2 left-3 text-sm leading-relaxed text-[var(--text-tertiary)] select-none">
                    {placeholder}
                  </div>
                }
              />
            }
            ErrorBoundary={LexicalErrorBoundary}
          />
          {mentions ? <MentionsPlugin /> : null}
        </div>
      </div>
      <HistoryPlugin />
      <ListPlugin />
      <CodeBlockPlugin />
      <AutoLinkPlugin matchers={URL_MATCHERS} />
      <MarkdownShortcutPlugin transformers={SHORTCUTS} />
      {autoFocus ? <AutoFocusPlugin defaultSelection="rootEnd" /> : null}
      <ValuePlugin value={value} onValueChange={onValueChange} />
      <KeysPlugin onSubmitShortcut={onSubmitShortcut} onEscape={onEscape} />
      <KeepInViewPlugin />
    </LexicalComposer>
  );
}

/** Keeps the editor and the caller's string in step both ways. */
function ValuePlugin({
  value,
  onValueChange,
}: {
  value: string;
  onValueChange: (value: string) => void;
}) {
  const [editor] = useLexicalComposerContext();
  const emitted = useRef(value);
  const onChange = useRef(onValueChange);
  onChange.current = onValueChange;

  useEffect(
    () =>
      editor.registerUpdateListener(({ editorState, dirtyElements, dirtyLeaves }) => {
        if (dirtyElements.size === 0 && dirtyLeaves.size === 0) return;
        const next = editorState.read($getMarkup);
        if (next === emitted.current) return;
        emitted.current = next;
        onChange.current(next);
      }),
    [editor],
  );

  // A value the editor did not produce (the box cleared after posting): load it in.
  useEffect(() => {
    if (value === emitted.current) return;
    emitted.current = value;
    editor.update(() => {
      $setMarkup(value);
      // Still typing in it (Cmd+Enter posted): keep the caret, now at the end of what is left.
      if (editor.getRootElement() === document.activeElement) $getRoot().selectEnd();
    });
  }, [editor, value]);

  return null;
}

function KeysPlugin({
  onSubmitShortcut,
  onEscape,
}: {
  onSubmitShortcut?: () => void;
  onEscape?: () => void;
}) {
  const [editor] = useLexicalComposerContext();
  const submit = useRef(onSubmitShortcut);
  const cancel = useRef(onEscape);
  submit.current = onSubmitShortcut;
  cancel.current = onEscape;

  useEffect(
    () =>
      mergeRegister(
        editor.registerCommand(
          KEY_ENTER_COMMAND,
          (event) => {
            if (!event || !(event.metaKey || event.ctrlKey)) return false;
            // Never a new line: with no handler here the keypress still reaches page shortcuts.
            event.preventDefault();
            submit.current?.();
            return true;
          },
          COMMAND_PRIORITY_LOW,
        ),
        editor.registerCommand(
          KEY_ESCAPE_COMMAND,
          () => {
            if (!cancel.current) return false;
            cancel.current();
            return true;
          },
          COMMAND_PRIORITY_LOW,
        ),
        editor.registerCommand(
          FORMAT_TEXT_COMMAND,
          (format) => !KEPT_FORMATS.includes(format),
          COMMAND_PRIORITY_LOW,
        ),
      ),
    [editor],
  );
  return null;
}

type HeadingTag = "h1" | "h2" | "h3";
type BlockKind = "paragraph" | HeadingTag | "bullet" | "number" | "quote" | "code";

/** What the caret sits in, for the toolbar's pressed states. */
function useSelectionState(editor: LexicalEditor) {
  const [state, setState] = useState({
    formats: new Set<TextFormatType>(),
    block: "paragraph" as BlockKind,
    /** The code block the caret is in, and its language ("" until one is picked or guessed). */
    code: null as { key: string; language: string } | null,
  });
  useEffect(
    () =>
      editor.registerUpdateListener(({ editorState }) =>
        editorState.read(() => {
          const selection = $getSelection();
          if (!$isRangeSelection(selection)) return;
          const formats = new Set(KEPT_FORMATS.filter((f) => selection.hasFormat(f)));
          const anchor = selection.anchor.getNode();
          const top = $isRootOrShadowRoot(anchor) ? anchor : anchor.getTopLevelElement();
          let block: BlockKind = "paragraph";
          let code: { key: string; language: string } | null = null;
          if ($isHeadingNode(top)) {
            const tag = top.getTag();
            block = tag === "h1" || tag === "h2" ? tag : "h3";
          } else if ($isListNode(top)) {
            const list = $getNearestNodeOfType(anchor, ListNode) ?? top;
            block = list.getListType() === "number" ? "number" : "bullet";
          } else if ($isQuoteNode(top)) block = "quote";
          else if ($isCodeNode(top)) {
            block = "code";
            const language = top.getLanguage();
            code = { key: top.getKey(), language: language ? normalizeCodeLanguage(language) : "" };
          }
          setState({ formats, block, code });
        }),
      ),
    [editor],
  );
  return state;
}

function Toolbar() {
  const [editor] = useLexicalComposerContext();
  const { formats, block, code } = useSelectionState(editor);

  // Pressing the style the block already has turns it back into a plain paragraph.
  const setBlock = (kind: HeadingTag | "quote" | "code") =>
    editor.update(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return;
      $setBlocksType(selection, () =>
        block === kind
          ? $createParagraphNode()
          : kind === "quote"
            ? $createQuoteNode()
            : kind === "code"
              ? $createCodeNode()
              : $createHeadingNode(kind),
      );
    });

  const setLanguage = (language: string) =>
    editor.update(() => {
      const node = code ? $getNodeByKey(code.key) : null;
      // "" hands it back to the guess, which runs as soon as the block changes.
      if ($isCodeNode(node)) node.setLanguage(language || undefined);
    });

  const format = (f: TextFormatType) => editor.dispatchCommand(FORMAT_TEXT_COMMAND, f);
  const list = (kind: "bullet" | "number") =>
    editor.dispatchCommand(
      block === kind
        ? REMOVE_LIST_COMMAND
        : kind === "bullet"
          ? INSERT_UNORDERED_LIST_COMMAND
          : INSERT_ORDERED_LIST_COMMAND,
      undefined,
    );

  const mod = navigator.userAgent.includes("Mac") ? "⌘" : "Ctrl+";
  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      className="flex flex-wrap items-center gap-0.5 border-b border-[var(--border)] px-1.5 py-1"
    >
      <ToolButton
        label={`Bold (${mod}B)`}
        pressed={formats.has("bold")}
        onPress={() => format("bold")}
      >
        <Bold className="size-3.5" aria-hidden />
      </ToolButton>
      <ToolButton
        label={`Italic (${mod}I)`}
        pressed={formats.has("italic")}
        onPress={() => format("italic")}
      >
        <Italic className="size-3.5" aria-hidden />
      </ToolButton>
      <ToolButton
        label="Strikethrough"
        pressed={formats.has("strikethrough")}
        onPress={() => format("strikethrough")}
      >
        <Strikethrough className="size-3.5" aria-hidden />
      </ToolButton>
      <ToolButton label="Inline code" pressed={formats.has("code")} onPress={() => format("code")}>
        <Code className="size-3.5" aria-hidden />
      </ToolButton>
      <span className="mx-1 h-4 w-px bg-[var(--border)]" aria-hidden />
      <ToolButton label="Heading 1 (# )" pressed={block === "h1"} onPress={() => setBlock("h1")}>
        <Heading1 className="size-3.5" aria-hidden />
      </ToolButton>
      <ToolButton label="Heading 2 (## )" pressed={block === "h2"} onPress={() => setBlock("h2")}>
        <Heading2 className="size-3.5" aria-hidden />
      </ToolButton>
      <ToolButton label="Heading 3 (### )" pressed={block === "h3"} onPress={() => setBlock("h3")}>
        <Heading3 className="size-3.5" aria-hidden />
      </ToolButton>
      <span className="mx-1 h-4 w-px bg-[var(--border)]" aria-hidden />
      <ToolButton label="Bulleted list" pressed={block === "bullet"} onPress={() => list("bullet")}>
        <List className="size-3.5" aria-hidden />
      </ToolButton>
      <ToolButton label="Numbered list" pressed={block === "number"} onPress={() => list("number")}>
        <ListOrdered className="size-3.5" aria-hidden />
      </ToolButton>
      <ToolButton label="Quote" pressed={block === "quote"} onPress={() => setBlock("quote")}>
        <Quote className="size-3.5" aria-hidden />
      </ToolButton>
      <ToolButton label="Code block" pressed={block === "code"} onPress={() => setBlock("code")}>
        <SquareCode className="size-3.5" aria-hidden />
      </ToolButton>
      {code ? (
        <select
          aria-label="Code language"
          value={code.language}
          onChange={(e) => setLanguage(e.target.value)}
          className="ml-auto h-7 rounded-[var(--lare-r-1)] border border-[var(--border)] bg-[var(--surface-raised)] px-1.5 text-xs text-[var(--text-secondary)] focus-visible:outline-2 focus-visible:outline-[var(--focus)]"
        >
          {code.language === "" ? <option value="">Detect language</option> : null}
          <option value={PLAIN_CODE}>Plain text</option>
          {CODE_LANGUAGES.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
          {code.language &&
          code.language !== PLAIN_CODE &&
          !CODE_LANGUAGES.some((l) => l.id === code.language) ? (
            <option value={code.language}>{code.language}</option>
          ) : null}
        </select>
      ) : null}
    </div>
  );
}

function ToolButton({
  label,
  pressed,
  onPress,
  children,
}: {
  label: string;
  pressed: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      // mousedown, so the editor keeps its selection instead of losing it to the button.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onPress}
      className={cn(
        "inline-flex size-7 items-center justify-center rounded-[var(--lare-r-1)] text-[var(--text-tertiary)] transition-colors",
        "hover:bg-[color-mix(in_oklab,var(--text)_8%,transparent)] hover:text-[var(--text)]",
        "focus-visible:outline-2 focus-visible:outline-[var(--focus)]",
        pressed && "bg-[color-mix(in_oklab,var(--text)_10%,transparent)] text-[var(--text)]",
      )}
    >
      {children}
    </button>
  );
}

interface Typing {
  key: string;
  start: number;
  end: number;
  query: string;
}

/**
 * Offers people to mention after `@`. Arrow keys move through the list, Enter or Tab picks,
 * Escape closes; with the list closed every key does what it always does. Picking writes plain
 * `@handle ` text, which is what the database looks for to notify them.
 */
function MentionsPlugin() {
  const [editor] = useLexicalComposerContext();
  const listId = useId();
  const [typing, setTyping] = useState<Typing | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(null);

  const open = typing !== null && dismissed !== `${typing.key}:${typing.start}`;
  const suggestions = useMentionSuggestions(open ? typing.query : null);
  const options = open ? (suggestions.data ?? []) : [];
  const shown = options.length > 0;
  const index = Math.min(active, Math.max(options.length - 1, 0));

  useEffect(
    () =>
      editor.registerUpdateListener(({ editorState }) => {
        const next = editorState.read((): Typing | null => {
          const selection = $getSelection();
          if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null;
          const node = selection.anchor.getNode();
          if (!$isTextNode(node) || node.hasFormat("code") || $isCodeNode(node.getParent())) {
            return null;
          }
          const offset = selection.anchor.offset;
          const found = mentionAtCaret(node.getTextContent(), offset);
          return found
            ? { key: node.getKey(), start: found.start, end: offset, query: found.query }
            : null;
        });
        setTyping((prev) =>
          prev?.key === next?.key && prev?.start === next?.start && prev?.end === next?.end
            ? prev
            : next,
        );
        if (next) {
          // Under the `@`, measured from the caret the browser drew.
          const range = window.getSelection()?.getRangeAt(0);
          const box = editor.getRootElement()?.parentElement?.getBoundingClientRect();
          const rect = range?.getBoundingClientRect();
          if (rect && box && rect.height > 0) {
            setAnchor({
              left: Math.max(0, rect.left - box.left - 8),
              top: rect.bottom - box.top + 4,
            });
          }
        }
      }),
    [editor],
  );

  // Fresh refs for the key handlers, which are registered once.
  const live = useRef({ shown, options, index, typing });
  live.current = { shown, options, index, typing };

  const pick = (handle: string) => {
    const at = live.current.typing;
    if (!at) return;
    editor.update(() => {
      const node = $getNodeByKey(at.key);
      if (!$isTextNode(node)) return;
      const text = node.getTextContent();
      // Swallow a space already after the caret, so picking never leaves two.
      const end = text[at.end] === " " ? at.end + 1 : at.end;
      node.spliceText(at.start, end - at.start, `@${handle} `, true);
    });
    setActive(0);
  };
  const pickRef = useRef(pick);
  pickRef.current = pick;

  useEffect(() => {
    const move = (step: number) => (event: KeyboardEvent | null) => {
      const { shown, options, index } = live.current;
      if (!shown) return false;
      event?.preventDefault();
      setActive((index + step + options.length) % options.length);
      return true;
    };
    const choose = (event: KeyboardEvent | null) => {
      const { shown, options, index } = live.current;
      const option = shown ? options[index] : undefined;
      if (!option) return false;
      event?.preventDefault();
      pickRef.current(option.handle);
      return true;
    };
    return mergeRegister(
      editor.registerCommand(KEY_ARROW_DOWN_COMMAND, move(1), COMMAND_PRIORITY_HIGH),
      editor.registerCommand(KEY_ARROW_UP_COMMAND, move(-1), COMMAND_PRIORITY_HIGH),
      editor.registerCommand(KEY_ENTER_COMMAND, choose, COMMAND_PRIORITY_HIGH),
      editor.registerCommand(KEY_TAB_COMMAND, choose, COMMAND_PRIORITY_HIGH),
      editor.registerCommand(
        KEY_ESCAPE_COMMAND,
        (event) => {
          const { shown, typing } = live.current;
          if (!shown || !typing) return false;
          event?.preventDefault();
          event?.stopPropagation();
          setDismissed(`${typing.key}:${typing.start}`);
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
    );
  }, [editor]);

  // Tell assistive tech about the list from the editable itself, as a combobox would.
  useEffect(() => {
    const root = editor.getRootElement();
    if (!root) return;
    root.setAttribute("aria-autocomplete", "list");
    root.setAttribute("aria-expanded", String(shown));
    if (shown) {
      root.setAttribute("aria-controls", listId);
      root.setAttribute("aria-activedescendant", `${listId}-${index}`);
    } else {
      root.removeAttribute("aria-controls");
      root.removeAttribute("aria-activedescendant");
    }
  }, [editor, shown, listId, index]);

  // Leaving the box closes the list.
  useEffect(() => {
    const root = editor.getRootElement();
    if (!root) return;
    const close = () => setTyping(null);
    root.addEventListener("blur", close);
    return () => root.removeEventListener("blur", close);
  }, [editor]);

  if (!shown) return null;
  return (
    <div
      id={listId}
      role="listbox"
      aria-label="People to mention"
      style={anchor ? { left: anchor.left, top: anchor.top } : undefined}
      className={cn(
        "absolute z-20 w-64 overflow-hidden rounded-[var(--lare-r-2)] border border-[var(--border)] bg-[var(--surface-raised)] py-1 shadow-lg",
        !anchor && "top-full left-2 mt-1",
      )}
    >
      {options.map((option, i) => (
        <div
          key={option.id}
          id={`${listId}-${i}`}
          role="option"
          aria-selected={i === index}
          tabIndex={-1}
          // mousedown, so the pick lands before the editor's blur closes the list.
          onMouseDown={(e) => {
            e.preventDefault();
            pick(option.handle);
          }}
          onMouseEnter={() => setActive(i)}
          className={cn(
            "flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm",
            i === index && "bg-[color-mix(in_oklab,var(--text)_8%,transparent)]",
          )}
        >
          <Avatar url={option.avatar_url} name={option.display_name ?? option.handle} size={20} />
          <span className="truncate text-[var(--text)]">
            {option.display_name ?? `@${option.handle}`}
          </span>
          {option.display_name ? (
            <span className="truncate text-xs text-[var(--text-tertiary)]">@{option.handle}</span>
          ) : null}
        </div>
      ))}
    </div>
  );
}
