import { formatDurationHuman } from "@lare/shared";
import { ArrowRight, Inbox } from "lucide-react";
import { Link } from "react-router";
import { KindBadge, SessionStatusBadge } from "@/components/ui/Badge";
import { LogColumns, PageHeader, StackedList, StackedListItem } from "@/components/ui/Card";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/ui/States";
import { formatListWhen, plural } from "@/lib/format";
import { type SessionRow, useSessions } from "./queries";

export function SessionsPage() {
  const sessions = useSessions();
  return (
    <>
      <PageHeader
        title="Sessions"
        subtitle="Everything the extension recorded, newest first."
        count={sessions.data ? plural(sessions.data.length, "session") : undefined}
      />
      {sessions.isPending ? (
        <ListSkeleton />
      ) : sessions.isError ? (
        <ErrorState error={sessions.error} onRetry={() => void sessions.refetch()} />
      ) : sessions.data.length === 0 ? (
        <EmptyState
          icon={<Inbox className="size-7" aria-hidden />}
          title="No sessions yet"
          description="Start a session from the Lare overlay on LeetCode and it will show up here."
        />
      ) : (
        <>
          <LogColumns columns={["Session", "Kind", "When", "Time", "Problems", ""]} />
          <StackedList>
            {sessions.data.map((s) => (
              <StackedListItem key={s.id}>
                <SessionItem session={s} />
              </StackedListItem>
            ))}
          </StackedList>
        </>
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

  const title =
    problems[0]?.title ?? (session.kind === "interview" ? "Mock interview" : "Practice session");
  const extra = problems.length > 1 ? ` +${problems.length - 1}` : "";
  const live = session.status === "active" || session.status === "paused";
  const when = formatListWhen(session.started_at);

  return (
    <div className="grid items-center gap-x-3 gap-y-1 px-3 py-2.5 sm:grid-cols-[minmax(0,1.4fr)_7rem_minmax(8rem,1fr)_4.5rem_5.5rem_auto]">
      <Link
        to={`/sessions/${session.id}`}
        className="min-w-0 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400/70"
      >
        <p className="truncate text-sm text-zinc-100">
          {title}
          {extra ? <span className="text-zinc-500">{extra}</span> : null}
        </p>
        <p className="truncate text-xs text-zinc-500 sm:hidden" title={when.title}>
          {when.label}
          <span aria-hidden> · </span>
          {formatDurationHuman(session.active_ms)}
        </p>
      </Link>
      <div className="hidden sm:block">
        <KindBadge kind={session.kind} />
      </div>
      <p className="hidden truncate text-xs text-zinc-500 sm:block" title={when.title}>
        {when.label}
      </p>
      <p className="hidden tabular-nums text-xs text-zinc-400 sm:block">
        {formatDurationHuman(session.active_ms)}
      </p>
      <p className="hidden text-xs text-zinc-400 sm:block">{plural(problems.length, "problem")}</p>
      <div className="flex shrink-0 items-center justify-end gap-2 text-xs">
        {live || session.status === "abandoned" ? (
          <SessionStatusBadge status={session.status} />
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
        ) : session.kind === "interview" ? (
          <Link to={`/sessions/${session.id}`} className="text-zinc-400 hover:text-zinc-100">
            Review
          </Link>
        ) : null}
      </div>
    </div>
  );
}
