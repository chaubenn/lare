import { formatDurationHuman } from "@lare/shared";
import { DifficultyBadge } from "@lare/ui";
import { Inbox, Sparkles } from "lucide-react";
import { Link } from "react-router";
import { KindBadge, SessionStatusBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/Card";
import { EmptyState, ErrorState, PageSpinner } from "@/components/ui/States";
import { formatDateTime, plural } from "@/lib/format";
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
        <ul className="divide-y divide-zinc-800/80 rounded-xl border border-zinc-800">
          {sessions.data.map((s) => (
            <li key={s.id}>
              <SessionItem session={s} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function SessionItem({ session }: { session: SessionRow }) {
  const problems = session.session_problems;
  const post = session.posts;
  const postLink = post ? (post.status === "draft" ? `/drafts/${post.id}` : `/posts/${post.id}`) : null;

  return (
    <div className="flex flex-wrap items-center gap-3 p-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
          <KindBadge kind={session.kind} />
          <SessionStatusBadge status={session.status} />
          <span>{formatDateTime(session.started_at)}</span>
          <span aria-hidden>·</span>
          <span>{formatDurationHuman(session.active_ms)}</span>
          <span aria-hidden>·</span>
          <span>{plural(problems.length, "problem")}</span>
        </div>
        {problems.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
            {problems.slice(0, 4).map((p) => (
              <span key={p.id} className="inline-flex items-center gap-1.5 text-sm text-zinc-300">
                {p.title}
                <DifficultyBadge difficulty={p.difficulty} />
              </span>
            ))}
            {problems.length > 4 ? (
              <span className="text-xs text-zinc-500">+{problems.length - 4} more</span>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {session.kind === "interview" ? (
          <Button size="sm" disabled icon={<Sparkles className="size-3.5" aria-hidden />}>
            Review (coming soon)
          </Button>
        ) : null}
        {postLink && post ? (
          <Link
            to={postLink}
            className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-100 hover:bg-zinc-800"
          >
            {post.status === "draft" ? "Open draft" : "View post"}
          </Link>
        ) : null}
      </div>
    </div>
  );
}
