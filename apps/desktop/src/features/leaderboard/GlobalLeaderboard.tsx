import { globalViewerInRows } from "@lare/shared";
import { Globe, Lock } from "lucide-react";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/ui/States";
import { LeaderboardItem } from "./LeaderboardItem";
import type { WeekOffset } from "./queries";
import { useGlobalLeaderboard } from "./queries";
import { LIST_CLASS } from "./styles";

/**
 * Everyone with a public account, ranked. A private account is never listed for anyone else, but
 * its owner still gets their own row beneath the list so they can see where they would stand.
 */
export function GlobalLeaderboard({ weekOffset }: { weekOffset: WeekOffset }) {
  const board = useGlobalLeaderboard(weekOffset);

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

  const { rows, viewer } = board.data;
  const listed = globalViewerInRows(board.data);
  // Beneath the list when the viewer is private, past the cut-off, or has not solved anything yet.
  const showViewer = viewer !== null && !listed;

  if (rows.length === 0 && !showViewer) {
    return (
      <EmptyState
        icon={<Globe className="size-8" aria-hidden />}
        title="Nobody has solved anything yet"
        description="Solve a problem this week and you'll be the first on the board."
      />
    );
  }

  return (
    <div className="space-y-3">
      {rows.length > 0 ? (
        <ol className={LIST_CLASS}>
          {rows.map((row) => (
            <LeaderboardItem key={row.user_id} row={row} />
          ))}
        </ol>
      ) : (
        <p className="text-sm text-[var(--text-secondary)]">
          Nobody has solved anything in this week yet.
        </p>
      )}

      {showViewer && viewer ? (
        <section aria-label="Your position">
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--text-tertiary)]">
            Your position
          </h2>
          <ol className={LIST_CLASS}>
            <LeaderboardItem
              row={viewer}
              note={
                viewer.is_private ? (
                  <span className="inline-flex items-center gap-1">
                    <Lock className="size-3" aria-hidden />
                    Only you can see this — your account is private
                  </span>
                ) : null
              }
            />
          </ol>
          {viewer.rank === null ? (
            <p className="mt-2 text-xs text-[var(--text-secondary)]">
              Solve a problem this week to get a place on the board.
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
