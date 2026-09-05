import { formatDurationHuman, formatLocalTimestamp } from "@lare/shared";
import { ArrowRight, Inbox } from "lucide-react";
import { Link } from "react-router";
import { PageHeader, StackedList, StackedListItem } from "@/components/ui/Card";
import { EmptyState, ErrorState, PageSpinner } from "@/components/ui/States";
import { plural } from "@/lib/format";
import { type SessionRow, useSessions } from "./queries";

export function SessionsPage() {
  const sessions = useSessions();
  return (
    <>
      <PageHeader title="Sessions" subtitle="Everything the extension recorded, newest first." />
      {sessions.isPending ? (
        <PageSpinner />
      ) : sessions.isError ? (
        <ErrorState error={sessions.error} onRetry={() => void sessions.refetch()} />
      ) : sessions.data.length === 0 ? (
        <EmptyState
          icon={<Inbox className="size-8" aria-hidden />}
          title="No sessions yet"
          description="Start a session from the Lare overlay on LeetCode and it will show up here."
        />
      ) : (
        <StackedList>
          {sessions.data.map((s) => (
            <StackedListItem key={s.id}>
              <SessionItem session={s} />
            </StackedListItem>
          ))}
        </StackedList>
      )}
    </>
  );
}

function SessionItem({ session }: { session: SessionRow }) {
  const problems = session.session_problems;
  const post = session.posts;
  const postLink = post
    ? post.status === "draft"
      ? `/drafts/${post.id}`
      : `/posts/${post.id}`
    : null;

  const reviewLink = `/sessions/${session.id}`;
  const kindLabel = session.kind === "interview" ? "Interview" : "Practice";
  const title =
    problems[0]?.title ?? (session.kind === "interview" ? "Mock interview" : "Practice session");
  const extra = problems.length > 1 ? ` +${problems.length - 1}` : "";
  const live = session.status === "active" || session.status === "paused";

  return (
    <div className="flex items-baseline gap-4 px-4 py-3.5">
      <Link
        to={reviewLink}
        className="min-w-0 flex-1 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400/70"
      >
        <p className="truncate text-sm text-zinc-100">
          {title}
          {extra ? <span className="text-zinc-500">{extra}</span> : null}
        </p>
        <p className="mt-0.5 truncate text-xs text-zinc-500">
          {kindLabel}
          <span aria-hidden> · </span>
          {formatLocalTimestamp(session.started_at)}
          <span aria-hidden> · </span>
          {formatDurationHuman(session.active_ms)}
          <span aria-hidden> · </span>
          {plural(problems.length, "problem")}
          {live ? (
            <>
              <span aria-hidden> · </span>
              <span className="text-zinc-300">{session.status}</span>
            </>
          ) : session.status === "abandoned" ? (
            <>
              <span aria-hidden> · </span>
              <span className="text-rose-400">abandoned</span>
            </>
          ) : null}
        </p>
      </Link>
      <div className="flex shrink-0 items-center gap-3 text-xs">
        {session.kind === "interview" ? (
          <Link to={reviewLink} className="text-zinc-400 hover:text-zinc-100">
            Review
          </Link>
        ) : null}
        {postLink && post ? (
          <Link
            to={postLink}
            className="inline-flex items-center gap-0.5 text-zinc-400 hover:text-zinc-100"
          >
            {post.status === "draft" ? (
              "Draft"
            ) : (
              <>
                Posted
                <ArrowRight className="size-3" aria-hidden />
              </>
            )}
          </Link>
        ) : null}
      </div>
    </div>
  );
}
