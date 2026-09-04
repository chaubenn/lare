import { useEffect, useState } from "react";
import { cn } from "./cn";

const LANG_ALIASES: Record<string, string> = {
  python3: "python",
  golang: "go",
  csharp: "csharp",
  "c#": "csharp",
  "c++": "cpp",
  mysql: "sql",
  postgresql: "sql",
};

/** Syntax-highlighted code via shiki (loaded lazily; plain <pre> until ready). */
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
  const language =
    (lang ? (LANG_ALIASES[lang.toLowerCase()] ?? lang.toLowerCase()) : "text") || "text";

  useEffect(() => {
    let cancelled = false;
    setHtml(null);
    import("shiki")
      .then(({ codeToHtml }) => codeToHtml(code, { lang: language, theme: "github-dark-default" }))
      .then((out) => {
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
        "lare-code overflow-auto rounded-xl border border-zinc-800 bg-[#0d1117] text-[13px] leading-relaxed",
        className,
      )}
      style={{ maxHeight }}
    >
      {html ? (
        // biome-ignore lint/security/noDangerouslySetInnerHtml: shiki output is generated from escaped source
        <div className="[&_pre]:m-0 [&_pre]:p-4" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <pre className="m-0 p-4 text-zinc-200">
          <code>{code}</code>
        </pre>
      )}
    </div>
  );
}
