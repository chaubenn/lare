import {
  type Leaderboard,
  type LeaderboardRow,
  leaderboardHasFriends,
  leaderboardWeekLabel,
} from "@lare/shared";
import { cn } from "@lare/ui";
import { Search, Trophy } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { SegmentedTabs } from "@/components/ui/SegmentedTabs";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/ui/States";
import { ProfileHoverCard } from "@/features/profile/ProfileHoverCard";
import { useWeeklyLeaderboard } from "./queries";

type Week = "this" | "last";

const WEEKS: Array<{ key: Week; label: string }> = [
  { key: "this", label: "This week" },
  { key: "last", label: "Last week" },
];

const DIFF = [
  { key: "easy", title: "Easy", color: "var(--lare-diff-easy)" },
  { key: "medium", title: "Medium", color: "var(--lare-diff-medium)" },
  { key: "hard", title: "Hard", color: "var(--lare-diff-hard)" },
] as const;

/** Distinct problems solved this week by you and the people you follow, ranked. */
export function LeaderboardTab({ onFind }: { onFind: () => void }) {
  const [week, setWeek] = useState<Week>("this");
  const offset = week === "this" ? 0 : -1;
  const board = useWeeklyLeaderboard(offset);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedTabs label="Leaderboard week" value={week} onChange={setWeek} items={WEEKS} />
        {board.data ? (
          <p className="text-xs text-[var(--text-secondary)]">
            {leaderboardWeekLabel(offset, board.data.week_start, board.data.week_end)}
          </p>
        ) : null}
      </div>
      <LeaderboardBody
        isPending={board.isPending}
        error={board.error}
        board={board.data}
        onRetry={() => void board.refetch()}
        onFind={onFind}
      />
    </div>
  );
}

function LeaderboardBody({
  isPending,
  error,
  board,
  onRetry,
  onFind,
}: {
  isPending: boolean;
  error: Error | null;
  board: Leaderboard | null | undefined;
  onRetry: () => void;
  onFind: () => void;
}) {
  if (isPending) return <ListSkeleton />;
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (!board) {
    return (
      <ErrorState error={new Error("The leaderboard isn't available yet.")} onRetry={onRetry} />
    );
  }
  if (!leaderboardHasFriends(board)) {
    return (
      <EmptyState
        icon={<Trophy className="size-8" aria-hidden />}
        title="No one to compete with yet"
        description="Follow people to see how your week stacks up against theirs."
        action={
          <Button size="sm" onClick={onFind} icon={<Search className="size-3.5" aria-hidden />}>
            Find people
          </Button>
        }
      />
    );
  }
  return (
    <ol className="divide-y divide-[var(--border)] overflow-hidden rounded-[var(--lare-r-4)] border border-[var(--border)] bg-[color-mix(in_oklab,var(--surface-raised)_40%,transparent)]">
      {board.rows.map((row) => (
        <LeaderboardItem key={row.user_id} row={row} />
      ))}
    </ol>
  );
}

function LeaderboardItem({ row }: { row: LeaderboardRow }) {
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
        {row.rank}
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
