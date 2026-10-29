import { leaderboardHasFriends } from "@lare/shared";
import { Search, Trophy } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/ui/States";
import { LeaderboardItem } from "./LeaderboardItem";
import type { WeekOffset } from "./queries";
import { useWeeklyLeaderboard } from "./queries";
import { LIST_CLASS } from "./styles";

/** Distinct problems solved this week by you and the people you follow, ranked. */
export function FriendsLeaderboard({
  weekOffset,
  onFind,
}: {
  weekOffset: WeekOffset;
  onFind: () => void;
}) {
  const board = useWeeklyLeaderboard(weekOffset);

  if (board.isPending) return <ListSkeleton />;
  if (board.error) return <ErrorState error={board.error} onRetry={() => void board.refetch()} />;
  if (!board.data) {
    return (
      <ErrorState
        error={new Error("The leaderboard isn't available yet.")}
        onRetry={() => void board.refetch()}
      />
    );
  }
  if (!leaderboardHasFriends(board.data)) {
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
    <ol className={LIST_CLASS}>
      {board.data.rows.map((row) => (
        <LeaderboardItem key={row.user_id} row={row} />
      ))}
    </ol>
  );
}
