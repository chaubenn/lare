import { formatDurationHuman } from "@lare/shared";
import { SquarePen } from "lucide-react";
import { Link } from "react-router";
import { KindBadge } from "@/components/ui/Badge";
import { PageHeader, StackedList, StackedListItem } from "@/components/ui/Card";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/ui/States";
import { formatListWhen, plural } from "@/lib/format";
import { type Draft, useDrafts } from "./queries";
import { TrackedProblems } from "./TrackedProblems";

export function DraftsPage() {
  const drafts = useDrafts();
  return (
    <>
      <PageHeader
        title="Drafts"
        subtitle="Problems the extension tracked, and the posts you have started."
        count={drafts.data ? plural(drafts.data.length, "draft") : undefined}
      />

      <TrackedProblems />
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
              <li>Solve problems on LeetCode as usual — there is nothing to start.</li>
              <li>Come back here: tracked problems appear above within a few seconds.</li>
              <li>Tick the ones that belong together and create a post.</li>
            </ol>
          }
        />
      ) : (
        <StackedList columns={["Session", "Kind", "When", "Time", "Problems"]}>
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
  const when = formatListWhen(draft.created_at);

  return (
    <>
      <Link
        to={`/drafts/${draft.id}`}
        className="min-w-0 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400/70"
      >
        <p className="truncate text-sm text-zinc-100">
          {title}
          {extra ? <span className="text-zinc-500">{extra}</span> : null}
        </p>
        <p className="truncate text-xs text-zinc-500 sm:hidden" title={when.title}>
          {session ? (session.kind === "interview" ? "Interview" : "Practice") : "Draft"}
          <span aria-hidden> · </span>
          {when.label}
          {session && session.active_ms > 0 ? (
            <>
              <span aria-hidden> · </span>
              {formatDurationHuman(session.active_ms)}
            </>
          ) : null}
        </p>
      </Link>
      <div className="hidden sm:block">
        {session ? (
          <KindBadge kind={session.kind} />
        ) : (
          <span className="text-xs text-zinc-600">—</span>
        )}
      </div>
      <p
        className="hidden whitespace-nowrap font-mono text-xs tabular-nums text-zinc-500 sm:block"
        title={when.title}
      >
        {when.label}
      </p>
      <p className="hidden tabular-nums text-xs text-zinc-400 sm:block">
        {session && session.active_ms > 0 ? formatDurationHuman(session.active_ms) : "—"}
      </p>
      <p className="hidden text-xs text-zinc-400 sm:block">{plural(problems.length, "problem")}</p>
      <Link
        to={`/drafts/${draft.id}`}
        className="hidden justify-self-end text-xs text-zinc-500 hover:text-zinc-100 sm:block"
      >
        Edit
      </Link>
    </>
  );
}
