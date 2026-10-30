import type { LeaderboardRow } from "@lare/shared";
import { cn } from "@lare/ui";
import { Lock } from "@lare/ui/icons";
import { Link } from "react-router";
import { Avatar } from "@/components/ui/Avatar";
import { ProfileHoverCard } from "@/features/profile/ProfileHoverCard";

const DIFF = [
  { key: "easy", title: "Easy", color: "var(--skill-easy)" },
  { key: "medium", title: "Medium", color: "var(--skill-medium)" },
  { key: "hard", title: "Hard", color: "var(--skill-hard)" },
] as const;

/**
 * One ranked person. `rank` is null for someone with no solves yet on a board that ranks only
 * solvers; `is_private` marks a private account on the global board.
 */
export function LeaderboardItem({
  row,
}: {
  row: Omit<LeaderboardRow, "rank"> & { rank: number | null; is_private?: boolean };
}) {
  const name = row.display_name?.trim() || `@${row.handle}`;
  const href = `/u/${row.handle}`;
  return (
    <li
      className={cn(
        "flex items-center gap-3 px-4 py-3",
        row.is_viewer && "bg-[color-mix(in_oklab,var(--accent)_10%,transparent)]",
      )}
    >
      <span className="w-6 shrink-0 text-center text-sm font-semibold tabular-nums text-[var(--text-secondary)]">
        {row.rank ?? "–"}
      </span>
      <ProfileHoverCard handle={row.handle} className="shrink-0">
        <Link to={href}>
          <Avatar url={row.avatar_url} name={name} size={36} />
        </Link>
      </ProfileHoverCard>
      <div className="min-w-0 flex-1">
        <Link
          to={href}
          className="block truncate text-sm font-semibold text-[var(--text)] hover:underline"
        >
          {name}
          {row.is_private ? (
            <Lock
              className="ml-1.5 inline size-3 align-[-1px] text-[var(--text-tertiary)]"
              aria-label="Private account"
            />
          ) : null}
          {row.is_viewer ? (
            <span className="ml-1.5 text-xs font-normal text-[var(--text-secondary)]">(you)</span>
          ) : null}
        </Link>
        <p className="truncate text-xs text-[var(--text-secondary)]">@{row.handle}</p>
      </div>
      <ul
        className="hidden items-center gap-3 text-xs tabular-nums sm:flex"
        aria-label="By difficulty"
      >
        {DIFF.map((d) => (
          <li key={d.key} className="flex items-center gap-1" title={d.title}>
            <span className="size-2 rounded-full" style={{ background: d.color }} aria-hidden />
            <span className="text-[var(--text-secondary)]">
              {row[d.key]}
              <span className="sr-only"> {d.title}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="w-14 shrink-0 text-right">
        <span className="block text-lg font-semibold leading-none tabular-nums text-[var(--text)]">
          {row.total}
        </span>
        <span className="text-[11px] text-[var(--text-tertiary)]">solved</span>
      </p>
    </li>
  );
}
