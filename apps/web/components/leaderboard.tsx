import {
  type Leaderboard,
  type LeaderboardRow,
  leaderboardHasFriends,
  leaderboardWeekLabel,
  parseLeaderboard,
} from "@lare/shared";
import { cn } from "@lare/ui/cn";
import { buttonClass, Card } from "@lare/ui/primitives";
import { Search, Trophy } from "lucide-react";
import Link from "next/link";
import { Avatar } from "@/components/avatar";
import { ProfileHoverCard } from "@/components/profile-hover-card";
import { TabNav } from "@/components/tab-nav";
import { createClient } from "@/lib/supabase/server";

export type LeaderboardWeek = "this" | "last";

export function parseLeaderboardWeek(raw: string | string[] | undefined): LeaderboardWeek {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === "last" ? "last" : "this";
}

const DIFF = [
  { key: "easy", title: "Easy", color: "var(--lare-diff-easy)" },
  { key: "medium", title: "Medium", color: "var(--lare-diff-medium)" },
  { key: "hard", title: "Hard", color: "var(--lare-diff-hard)" },
] as const;

/** Distinct problems solved this week by the viewer and the people they follow, ranked. */
export async function LeaderboardTab({
  viewerId,
  week,
}: {
  viewerId: string;
  week: LeaderboardWeek;
}) {
  const offset = week === "last" ? -1 : 0;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("weekly_leaderboard", { week_offset: offset });
  const board = error ? null : parseLeaderboard(data);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TabNav
          label="Leaderboard week"
          active={week}
          items={[
            { key: "this", label: "This week", href: "/friends?tab=leaderboard" },
            { key: "last", label: "Last week", href: "/friends?tab=leaderboard&week=last" },
          ]}
        />
        {board ? (
          <p className="text-xs text-[var(--text-secondary)]">
            {leaderboardWeekLabel(offset, board.week_start, board.week_end)}
          </p>
        ) : null}
      </div>
      <LeaderboardBody board={board} viewerId={viewerId} />
    </div>
  );
}

function LeaderboardBody({ board, viewerId }: { board: Leaderboard | null; viewerId: string }) {
  if (!board) {
    return (
      <Card className="px-6 py-12 text-center text-sm text-[var(--text-secondary)]">
        The leaderboard isn't available right now.
      </Card>
    );
  }
  if (!leaderboardHasFriends(board)) {
    return (
      <Card className="px-6 py-12 text-center">
        <Trophy className="mx-auto size-8 text-[var(--text-tertiary)]" aria-hidden />
        <p className="mx-auto mt-3 max-w-sm text-sm text-[var(--text-secondary)]">
          Follow people to see how your week stacks up against theirs.
        </p>
        <Link href="/friends?tab=find" className={cn(buttonClass("secondary", "sm"), "mt-4")}>
          <Search className="size-3.5" aria-hidden /> Find people
        </Link>
      </Card>
    );
  }
  return (
    <ol className="divide-y divide-[var(--border)] overflow-hidden rounded-[var(--lare-r-4)] border border-[var(--border)] bg-[color-mix(in_oklab,var(--surface-raised)_40%,transparent)]">
      {board.rows.map((row) => (
        <LeaderboardItem key={row.user_id} row={row} viewerId={viewerId} />
      ))}
    </ol>
  );
}

function LeaderboardItem({ row, viewerId }: { row: LeaderboardRow; viewerId: string }) {
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
      <ProfileHoverCard handle={row.handle} viewerId={viewerId} className="shrink-0">
        <Link href={href}>
          <Avatar src={row.avatar_url} name={name} size="sm" />
        </Link>
      </ProfileHoverCard>
      <div className="min-w-0 flex-1">
        <Link
          href={href}
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
