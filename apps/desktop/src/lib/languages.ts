/** Monaco language id -> display name. */
const LANGUAGE_LABELS: Record<string, string> = {
  python: "Python",
  python3: "Python3",
  cpp: "C++",
  c: "C",
  java: "Java",
  javascript: "JavaScript",
  typescript: "TypeScript",
  golang: "Go",
  go: "Go",
  rust: "Rust",
  kotlin: "Kotlin",
  swift: "Swift",
  csharp: "C#",
  ruby: "Ruby",
  scala: "Scala",
  php: "PHP",
  dart: "Dart",
  racket: "Racket",
  erlang: "Erlang",
  elixir: "Elixir",
  mysql: "MySQL",
  postgresql: "PostgreSQL",
};

/** Display name for a language id; an id without a label is shown as it is. */
export function languageLabel(lang: string | null | undefined): string | null {
  if (!lang) return null;
  return LANGUAGE_LABELS[lang] ?? lang;
}
