import { Badge } from "./primitives/Badge";

const TONE = {
  Easy: "easy",
  Medium: "medium",
  Hard: "hard",
} as const;

export function DifficultyBadge({
  difficulty,
  className,
}: {
  difficulty: "Easy" | "Medium" | "Hard" | null | undefined;
  className?: string;
}) {
  if (!difficulty) return null;
  return (
    <Badge tone={TONE[difficulty]} className={className}>
      {difficulty}
    </Badge>
  );
}
