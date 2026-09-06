import { formatDurationHuman } from "@lare/shared";
import { SquarePen } from "lucide-react";
import { Link } from "react-router";
import { KindBadge } from "@/components/ui/Badge";
import { LogColumns, PageHeader, StackedList, StackedListItem } from "@/components/ui/Card";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/ui/States";
import { formatListWhen, plural } from "@/lib/format";
import { type Draft, useDrafts } from "./queries";

export function DraftsPage() {
  const drafts = useDrafts();
  return (
    <>
      <PageHeader
        title="Drafts"
        subtitle="Sessions that landed from the extension. Review, write a note, publish."
        count={drafts.data ? plural(drafts.data.length, "draft") : undefined}
      />
      {drafts.isPending ? (
        <ListSkeleton />
      ) : drafts.isError ? (
        <ErrorState error={drafts.error} onRetry={() => void drafts.refetch()} />
      ) : drafts.data.length === 0 ? (
        <EmptyState
          icon={<SquarePen className="size-7" aria-hidden />}
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
        <>
          <LogColumns columns={["Session", "Kind", "When", "Time", "Problems", ""]} />
          <StackedList>
            {drafts.data.map((d) => (
              <StackedListItem key={d.id}>
                <DraftRow draft={d} />
              </StackedListItem>
            ))}
          </StackedList>
        </>
      )}
    </>
  );
}

function DraftRow({ draft }: { draft: Draft }) {
  const session = draft.sessions;
  const problems = session?.session_problems ?? [];
  const title = draft.title?.trim() || problems[0]?.title || "Untitled session";
  const extra = problems.length > 1 ? ` +${problems.length - 1}` : "";
  const when = formatListWhen(draft.created_at);

  return (
    <Link
      to={`/drafts/${draft.id}`}
      className="grid items-center gap-x-3 gap-y-1 px-3 py-2.5 sm:grid-cols-[minmax(0,1.4fr)_7rem_minmax(8rem,1fr)_4.5rem_5.5rem_auto]"
    >
      <p className="min-w-0 truncate text-sm text-zinc-100">
        {title}
        {extra ? <span className="text-zinc-500">{extra}</span> : null}
      </p>
      <div className="hidden sm:block">
        {session ? (
          <KindBadge kind={session.kind} />
        ) : (
          <span className="text-xs text-zinc-600">—</span>
        )}
      </div>
      <p className="hidden truncate text-xs text-zinc-500 sm:block" title={when.title}>
        {when.label}
      </p>
      <p className="hidden tabular-nums text-xs text-zinc-400 sm:block">
        {session ? formatDurationHuman(session.active_ms) : "—"}
      </p>
      <p className="hidden text-xs text-zinc-400 sm:block">{plural(problems.length, "problem")}</p>
      <span className="hidden text-xs text-zinc-500 sm:block">Edit</span>
      <p className="truncate text-xs text-zinc-500 sm:hidden" title={when.title}>
        {session ? (session.kind === "interview" ? "Interview" : "Practice") : "Draft"}
        <span aria-hidden> · </span>
        {when.label}
        {session ? (
          <>
            <span aria-hidden> · </span>
            {formatDurationHuman(session.active_ms)}
          </>
        ) : null}
      </p>
    </Link>
  );
}
