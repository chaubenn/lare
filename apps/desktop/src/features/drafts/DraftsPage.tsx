import { formatDurationHuman, formatLocalTimestamp } from "@lare/shared";
import { SquarePen } from "lucide-react";
import { Link } from "react-router";
import { PageHeader, StackedList, StackedListItem } from "@/components/ui/Card";
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
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-left">
              <li>Install the Lare Chrome extension and sign in with the same account.</li>
              <li>Open a problem on LeetCode and start a session from the Lare overlay.</li>
              <li>Solve, submit, then end the session.</li>
              <li>Come back here: the draft appears within a few seconds.</li>
            </ol>
          }
        />
      ) : (
        <StackedList>
          {drafts.data.map((d) => (
            <StackedListItem key={d.id}>
              <DraftRow draft={d} />
            </StackedListItem>
          ))}
        </StackedList>
      )}
    </>
  );
}

function DraftRow({ draft }: { draft: Draft }) {
  const session = draft.sessions;
  const problems = session?.session_problems ?? [];
  const title = draft.title?.trim() || problems[0]?.title || "Untitled session";
  const extra = problems.length > 1 ? ` +${problems.length - 1}` : "";
  const kindLabel = session ? (session.kind === "interview" ? "Interview" : "Practice") : null;

  return (
    <div className="flex items-baseline gap-4 px-4 py-3.5">
      <Link
        to={`/drafts/${draft.id}`}
        className="min-w-0 flex-1 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400/70"
      >
        <p className="truncate text-sm text-zinc-100">
          {title}
          {extra ? <span className="text-zinc-500">{extra}</span> : null}
        </p>
        <p className="mt-0.5 truncate text-xs text-zinc-500">
          {kindLabel ? (
            <>
              {kindLabel}
              <span aria-hidden> · </span>
            </>
          ) : null}
          {formatLocalTimestamp(draft.created_at)}
          {session ? (
            <>
              <span aria-hidden> · </span>
              {formatDurationHuman(session.active_ms)}
            </>
          ) : null}
          <span aria-hidden> · </span>
          {plural(problems.length, "problem")}
        </p>
      </Link>
      <div className="flex shrink-0 items-center gap-3 text-xs">
        <Link to={`/drafts/${draft.id}`} className="text-zinc-400 hover:text-zinc-100">
          Edit
        </Link>
      </div>
    </div>
  );
}
