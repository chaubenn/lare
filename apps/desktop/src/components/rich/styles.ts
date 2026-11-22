import type { EditorThemeClasses } from "lexical";

/**
 * One look for formatted text, shared by the editor and the read-only render, so what you see
 * while writing is what everyone sees after.
 */
export const RICH = {
  paragraph: "",
  h1: "mt-3 mb-1 text-xl font-semibold leading-snug text-[var(--text)] first:mt-0",
  h2: "mt-3 mb-1 text-lg font-semibold leading-snug text-[var(--text)] first:mt-0",
  h3: "mt-2 mb-0.5 text-base font-semibold leading-snug text-[var(--text)] first:mt-0",
  ul: "list-disc pl-5",
  ol: "list-decimal pl-5",
  li: "",
  quote: "border-l-2 border-[var(--border-strong)] pl-3 text-[var(--text-secondary)]",
  // The same ink panel as code everywhere else in the app (`CodeBlock`), highlighted or not.
  codeBlock:
    "my-1.5 block overflow-x-auto whitespace-pre rounded-[var(--lare-r-4)] border border-[var(--border)] bg-[var(--lare-ink)] p-4 font-mono text-[13px] leading-relaxed text-[var(--lare-bone)] [tab-size:4]",
  code: "rounded-[var(--lare-r-1)] bg-[color-mix(in_oklab,var(--text)_9%,transparent)] px-1 py-px font-mono text-[0.85em] text-[var(--text)]",
  bold: "font-semibold text-[var(--text)]",
  italic: "italic",
  strike: "line-through",
  link: "text-[var(--accent-text)] underline-offset-2 hover:underline",
  mention: "font-medium text-[var(--accent-text)] hover:underline",
} as const;

export const EDITOR_THEME: EditorThemeClasses = {
  paragraph: RICH.paragraph,
  heading: { h1: RICH.h1, h2: RICH.h2, h3: RICH.h3, h4: RICH.h3, h5: RICH.h3, h6: RICH.h3 },
  quote: RICH.quote,
  code: RICH.codeBlock,
  link: RICH.link,
  list: {
    ul: RICH.ul,
    ol: RICH.ol,
    listitem: RICH.li,
    nested: { listitem: "list-none" },
  },
  text: {
    bold: RICH.bold,
    italic: RICH.italic,
    strikethrough: RICH.strike,
    code: RICH.code,
  },
};
