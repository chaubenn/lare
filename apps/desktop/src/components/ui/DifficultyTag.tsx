const DIFFICULTY: Record<string, { label: string; color: string }> = {
  Easy: { label: "Easy", color: "var(--lare-diff-easy)" },
  Medium: { label: "Med", color: "var(--lare-diff-medium)" },
  Hard: { label: "Hard", color: "var(--lare-diff-hard)" },
};

/** LeetCode difficulty as a fixed-width coloured block, so titles line up down a list. */
export function DifficultyTag({
  difficulty,
  rounded = false,
}: {
  difficulty: string | null | undefined;
  rounded?: boolean;
}) {
  const d = difficulty ? DIFFICULTY[difficulty] : undefined;
  if (!d) return null;
  return (
    <span
      className={`inline-flex w-11 shrink-0 items-center justify-center self-stretch py-1 text-[11px] font-semibold uppercase tracking-wide ${rounded ? "rounded-[var(--lare-r-1)]" : ""}`}
      // A light tint: brighter text and a softer wash than the raw difficulty colour.
      style={{
        color: `color-mix(in oklab, ${d.color} 55%, var(--lare-bone))`,
        background: `color-mix(in oklab, ${d.color} 30%, transparent)`,
      }}
    >
      {d.label}
    </span>
  );
}
