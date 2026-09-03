import { cn } from "./cn";

const STYLES: Record<string, string> = {
  Easy: "bg-emerald-500/15 text-emerald-400",
  Medium: "bg-amber-500/15 text-amber-400",
  Hard: "bg-rose-500/15 text-rose-400",
};

export function DifficultyBadge({
  difficulty,
  className,
}: {
  difficulty: "Easy" | "Medium" | "Hard" | null | undefined;
  className?: string;
}) {
  if (!difficulty) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold",
        STYLES[difficulty] ?? "bg-zinc-500/15 text-zinc-300",
        className,
      )}
    >
      {difficulty}
    </span>
  );
}
