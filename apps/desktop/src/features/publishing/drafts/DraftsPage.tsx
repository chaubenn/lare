import { formatDurationHuman, showsActiveTime } from "@lare/shared";
import { SquarePen, Trash2 } from "@lare/ui/icons";
import { Link } from "react-router";
import { KindBadge } from "@/components/ui/Badge";
import { SectionTitle, StackedList, StackedListItem } from "@/components/ui/Card";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/ui/States";
import { useNotify } from "@/features/notifications/notices";
import { isPracticePost, useDeletePracticePost } from "@/features/publishing/posts/postActions";
import { PageBlurb } from "@/features/shell/PageBlurb";
import { confirm } from "@/lib/confirm";
import { formatListWhen, plural } from "@/lib/format";
import { errorMessage } from "@/lib/supabase";
import { type Draft, useDeleteDraft, useDrafts } from "./queries";
import { TrackedProblems } from "./TrackedProblems";

/**
 * Post, kind, time of day, active time, then the row's action. The title column is capped so
 * the details sit next to it instead of across an empty gap on a wide window.
 */
const DRAFT_TRACKS = "sm:grid-cols-[minmax(0,30rem)_7.5rem_5.5rem_4.5rem_minmax(5rem,1fr)]";

export function DraftsPage() {
  const drafts = useDrafts();
  return (
    <>
      <PageBlurb>Problems the extension tracked, and the posts you have started.</PageBlurb>

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
        <section aria-labelledby="draft-posts">
          <SectionTitle
            className="px-1"
            action={
              <span className="lare-micro tabular-nums text-[var(--text-tertiary)]">
                {plural(drafts.data.length, "draft")}
              </span>
            }
          >
            <span id="draft-posts">Not posted yet</span>
          </SectionTitle>
          <StackedList columns={["Post", "Kind", "Time", "Length"]} tracks={DRAFT_TRACKS}>
            {groupByDay(drafts.data).map((group) => (
              <DayGroup key={group.key} label={group.label} drafts={group.drafts} />
            ))}
          </StackedList>
        </section>
      )}
    </>
  );
}

function DayGroup({ label, drafts }: { label: string; drafts: Draft[] }) {
  return (
    <>
      <li className="lare-micro border-t border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-[color-mix(in_oklab,var(--surface-raised)_35%,transparent)] px-3 py-1.5 font-medium text-[var(--text-tertiary)] first:border-t-0 sm:col-span-full">
        {label}
      </li>
      {drafts.map((d) => (
        <StackedListItem key={d.id} className="group relative">
          <DraftRow draft={d} />
        </StackedListItem>
      ))}
    </>
  );
}

function DraftRow({ draft }: { draft: Draft }) {
  const session = draft.sessions;
  const problems = session?.session_problems ?? [];
  const title = draft.title?.trim() || problems[0]?.title || "Untitled session";
  const extra = problems.length > 1 ? ` +${problems.length - 1}` : "";
  const when = formatListWhen(draft.created_at);
  const time = timeOfDay(draft.created_at);
  const kind = session ? (session.kind === "interview" ? "Interview" : "Practice") : "Draft";
  const active =
    session && showsActiveTime(session.kind, session.active_ms)
      ? formatDurationHuman(session.active_ms)
      : null;

  return (
    <>
      {/* The link covers the whole row, so any part of it opens the draft. */}
      <Link
        to={`/drafts/${draft.id}`}
        className="min-w-0 rounded-sm after:absolute after:inset-0 after:content-[''] focus-visible:outline-none"
      >
        <p className="truncate text-sm text-[var(--text)]">
          {title}
          {extra ? <span className="text-[var(--text-tertiary)]">{extra}</span> : null}
        </p>
        <ProblemSummary draft={draft} />
        <p className="truncate text-xs text-[var(--text-tertiary)] sm:hidden" title={when.title}>
          {kind}
          <span aria-hidden> · </span>
          {time}
          {active ? (
            <>
              <span aria-hidden> · </span>
              {active}
            </>
          ) : null}
        </p>
      </Link>
      <div className="hidden sm:block">
        {session ? (
          <KindBadge kind={session.kind} />
        ) : (
          <span className="text-xs text-[var(--text-tertiary)]">—</span>
        )}
      </div>
      <p
        className="hidden whitespace-nowrap text-xs tabular-nums text-[var(--text-secondary)] sm:block"
        title={when.title}
      >
        {time}
      </p>
      <p className="hidden text-xs tabular-nums text-[var(--text-secondary)] sm:block">
        {active ?? <span className="text-[var(--text-tertiary)]">—</span>}
      </p>
      <div className="hidden justify-self-end sm:block">
        {problems.length === 0 ? (
          <DeleteEmptyDraft id={draft.id} practice={isPracticePost(session?.client)} />
        ) : (
          <span
            aria-hidden
            className="text-xs text-[var(--text-secondary)] opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
          >
            Edit
          </span>
        )}
      </div>
    </>
  );
}

const DIFFICULTY_TEXT = {
  Easy: "text-[var(--lare-diff-easy)]",
  Medium: "text-[var(--lare-diff-medium)]",
  Hard: "text-[var(--lare-diff-hard)]",
} as const;

/** What happened in the session, so rows with the same title can be told apart. */
function ProblemSummary({ draft }: { draft: Draft }) {
  const problems = draft.sessions?.session_problems ?? [];
  const [problem] = problems;
  if (!problem) {
    return <p className="truncate text-xs text-[var(--lare-status-pause)]">No problems to post</p>;
  }

  if (problems.length > 1) {
    const solved = problems.filter((p) => (p.submissions ?? []).some((s) => s.accepted)).length;
    return (
      <p className="truncate text-xs text-[var(--text-tertiary)]">
        {plural(problems.length, "problem")} · {solved} accepted
      </p>
    );
  }

  const submissions = problem.submissions ?? [];
  const accepted = submissions.some((s) => s.accepted);
  const result = accepted
    ? submissions.length > 1
      ? `Accepted after ${submissions.length} submissions`
      : "Accepted"
    : submissions.length === 0
      ? "No submissions"
      : `${plural(submissions.length, "submission")}, none accepted`;

  return (
    <p className="truncate text-xs text-[var(--text-tertiary)]">
      {problem.difficulty ? (
        <>
          <span className={DIFFICULTY_TEXT[problem.difficulty]}>{problem.difficulty}</span>
          <span aria-hidden> · </span>
        </>
      ) : null}
      {result}
    </p>
  );
}

/**
 * A draft with nothing in it can only be deleted, so offer that on the row itself. One made from
 * Tracked problems goes through `delete_practice_post` so the session minted for it goes too.
 */
function DeleteEmptyDraft({ id, practice }: { id: string; practice: boolean }) {
  const removeDraft = useDeleteDraft();
  const removePractice = useDeletePracticePost();
  const remove = practice ? removePractice : removeDraft;
  const { notify } = useNotify();

  async function doDelete() {
    const ok = await confirm({
      title: "Delete draft",
      message: "Delete this empty draft? It has no problems to post.",
      confirmLabel: "Delete",
      cancelLabel: "Keep",
      destructive: true,
    });
    if (!ok) return;
    try {
      if (practice) await removePractice.mutateAsync(id);
      else await removeDraft.mutateAsync(id);
      notify({ title: "Draft deleted" });
    } catch (err) {
      notify({ title: "Couldn't delete", description: errorMessage(err), variant: "error" });
    }
  }

  return (
    <button
      type="button"
      disabled={remove.isPending}
      onClick={() => void doDelete()}
      className="relative z-10 inline-flex items-center gap-1 rounded-sm text-xs text-[var(--text-secondary)] hover:text-[var(--lare-danger)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] disabled:opacity-50"
    >
      <Trash2 className="size-3.5" aria-hidden />
      Delete
    </button>
  );
}

/** "4:20 pm"; the day is in the group heading above. */
function timeOfDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d
    .toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })
    .toLowerCase();
}

/** "Today", "Yesterday", "Mon 15 Sep", with the year once it is not this one. */
function dayLabel(d: Date, now: Date): string {
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(d)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return d.toLocaleDateString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(d.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

/** Drafts arrive newest first; keep that order and cut it at each new day. */
function groupByDay(drafts: Draft[]): Array<{ key: string; label: string; drafts: Draft[] }> {
  const now = new Date();
  const groups: Array<{ key: string; label: string; drafts: Draft[] }> = [];
  for (const draft of drafts) {
    const d = new Date(draft.created_at);
    const key = d.toDateString();
    const last = groups.at(-1);
    if (last && last.key === key) last.drafts.push(draft);
    else groups.push({ key, label: dayLabel(d, now), drafts: [draft] });
  }
  return groups;
}
