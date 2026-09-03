import { formatDurationHuman, formatRelativeTime } from "@lare/shared";
import { DifficultyBadge } from "@lare/ui";
import { SquarePen } from "lucide-react";
import { Link } from "react-router";
import { KindBadge } from "@/components/ui/Badge";
import { PageHeader } from "@/components/ui/Card";
import { EmptyState, ErrorState, PageSpinner } from "@/components/ui/States";
import { plural } from "@/lib/format";
import { type Draft, useDrafts } from "./queries";

export function DraftsPage() {
  const drafts = useDrafts();
  return (
    <>
      <PageHeader
        title="Drafts"
        subtitle="Every session you end in the extension lands here. Review, write a note, publish."
      />
      {drafts.isPending ? (
        <PageSpinner />
      ) : drafts.isError ? (
        <ErrorState error={drafts.error} onRetry={() => void drafts.refetch()} />
      ) : drafts.data.length === 0 ? (
        <EmptyState
          icon={<SquarePen className="size-8" aria-hidden />}
          title="No drafts yet"
          description={
            <ol className="mt-2 list-decimal space-y-1 text-left pl-5">
              <li>Install the Lare Chrome extension and sign in with the same account.</li>
              <li>Open a problem on LeetCode and start a session from the Lare overlay.</li>
              <li>Solve, submit, then end the session.</li>
              <li>Come back here: the draft appears within a few seconds.</li>
            </ol>
          }
        />
      ) : (
        <ul className="space-y-3">
          {drafts.data.map((d) => (
            <li key={d.id}>
              <DraftRow draft={d} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function DraftRow({ draft }: { draft: Draft }) {
  const session = draft.sessions;
  const problems = session?.session_problems ?? [];
  const title = draft.title || problems.map((p) => p.title).join(", ") || "Untitled session";
  return (
    <Link
      to={`/drafts/${draft.id}`}
      className="block rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 transition-colors hover:border-zinc-700 hover:bg-zinc-900/70"
    >
      <div className="flex items-center gap-2 text-xs text-zinc-500">
        {session ? <KindBadge kind={session.kind} /> : null}
        <span>{formatRelativeTime(draft.created_at)}</span>
        {session ? (
          <>
            <span aria-hidden>·</span>
            <span>{formatDurationHuman(session.active_ms)}</span>
          </>
        ) : null}
        <span aria-hidden>·</span>
        <span>{plural(problems.length, "problem")}</span>
      </div>
      <h3 className="mt-2 truncate text-base font-semibold text-zinc-100">{title}</h3>
      {problems.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {problems.slice(0, 5).map((p) => (
            <span key={p.id} className="inline-flex items-center gap-1.5 text-xs text-zinc-400">
              {p.title}
              <DifficultyBadge difficulty={p.difficulty} />
            </span>
          ))}
        </div>
      ) : null}
    </Link>
  );
}
