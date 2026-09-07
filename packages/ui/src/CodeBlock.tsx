"use client";

import { LANGUAGE_LABELS } from "@lare/shared";
import { useEffect, useState } from "react";
import { cn } from "./cn";
import { brand } from "./tokens";

const LANG_ALIASES: Record<string, string> = {
  python3: "python",
  golang: "go",
  csharp: "csharp",
  "c#": "csharp",
  "c++": "cpp",
  mysql: "sql",
  postgresql: "sql",
};

const SHIKI_LANG_LOADERS = {
  python: () => import("@shikijs/langs/python"),
  cpp: () => import("@shikijs/langs/cpp"),
  c: () => import("@shikijs/langs/c"),
  java: () => import("@shikijs/langs/java"),
  javascript: () => import("@shikijs/langs/javascript"),
  typescript: () => import("@shikijs/langs/typescript"),
  go: () => import("@shikijs/langs/go"),
  rust: () => import("@shikijs/langs/rust"),
  kotlin: () => import("@shikijs/langs/kotlin"),
  swift: () => import("@shikijs/langs/swift"),
  csharp: () => import("@shikijs/langs/csharp"),
  ruby: () => import("@shikijs/langs/ruby"),
  scala: () => import("@shikijs/langs/scala"),
  php: () => import("@shikijs/langs/php"),
  dart: () => import("@shikijs/langs/dart"),
  elixir: () => import("@shikijs/langs/elixir"),
  sql: () => import("@shikijs/langs/sql"),
} as const;

const THEME_NAME = "lare-ink";

const THEME = {
  name: THEME_NAME,
  type: "dark" as const,
  colors: {
    "editor.background": brand.ink,
    "editor.foreground": brand.bone,
  },
  tokenColors: [
    { scope: ["comment", "punctuation.definition.comment"], settings: { foreground: brand.muted } },
    { scope: ["string"], settings: { foreground: "#c4b89a" } },
    { scope: ["keyword", "storage", "storage.type"], settings: { foreground: brand.statusPause } },
    { scope: ["entity.name.function", "support.function"], settings: { foreground: brand.paper } },
    {
      scope: ["constant", "variable.other.constant", "support.constant"],
      settings: { foreground: brand.statusRun },
    },
    { scope: ["entity.name.type", "support.type"], settings: { foreground: "#b8a88a" } },
    { scope: ["variable"], settings: { foreground: brand.bone } },
  ],
};

type Highlighter = {
  codeToHtml: (code: string, opts: { lang: string; theme: string }) => string;
};

let highlighterPromise: Promise<Highlighter> | null = null;
const resultCache = new Map<string, string>();

function resolveLang(lang: string | null | undefined): string {
  const raw = (lang ? (LANG_ALIASES[lang.toLowerCase()] ?? lang.toLowerCase()) : "text") || "text";
  if (raw in SHIKI_LANG_LOADERS) return raw;
  if (raw in LANGUAGE_LABELS) {
    const aliased = LANG_ALIASES[raw];
    if (aliased && aliased in SHIKI_LANG_LOADERS) return aliased;
  }
  return "text";
}

async function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = (async () => {
      const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] = await Promise.all([
        import("shiki/core"),
        import("shiki/engine/javascript"),
      ]);
      const loaded = await Promise.all(
        Object.values(SHIKI_LANG_LOADERS).map((load) =>
          load()
            .then((m) => m.default)
            .catch(() => null),
        ),
      );
      const langs = loaded.filter((lang) => lang != null);
      return createHighlighterCore({
        themes: [THEME],
        langs,
        engine: createJavaScriptRegexEngine(),
      }) as Promise<Highlighter>;
    })();
  }
  return highlighterPromise;
}

/** Syntax-highlighted code via shiki/core (explicit langs, warm-ink theme, cached). */
export function CodeBlock({
  code,
  lang,
  className,
  maxHeight = 480,
}: {
  code: string;
  lang: string | null | undefined;
  className?: string;
  maxHeight?: number;
}) {
  const [html, setHtml] = useState<string | null>(null);
  const language = resolveLang(lang);

  useEffect(() => {
    let cancelled = false;
    const key = `${language}\n${code}`;
    const cached = resultCache.get(key);
    if (cached) {
      setHtml(cached);
      return;
    }
    setHtml(null);
    getHighlighter()
      .then((hl) =>
        hl.codeToHtml(code, { lang: language === "text" ? "text" : language, theme: THEME_NAME }),
      )
      .then((out) => {
        resultCache.set(key, out);
        if (!cancelled) setHtml(out);
      })
      .catch(() => {
        if (!cancelled) setHtml(null);
      });
    return () => {
      cancelled = true;
    };
  }, [code, language]);

  return (
    <div
      className={cn(
        "lare-code overflow-auto rounded-[var(--lare-r-4)] border border-[var(--border)] bg-[var(--surface)] text-[13px] leading-relaxed",
        className,
      )}
      style={{ maxHeight }}
    >
      {html ? (
        // biome-ignore lint/security/noDangerouslySetInnerHtml: shiki output is generated from escaped source
        <div className="[&_pre]:m-0 [&_pre]:p-4" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <pre className="m-0 p-4 text-[var(--text)]">
          <code>{code}</code>
        </pre>
      )}
    </div>
  );
}
