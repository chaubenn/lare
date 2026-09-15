import { formatDurationHuman } from "@lare/shared";
import { ArrowRight, ChevronRight, Inbox } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { KindBadge, SessionStatusBadge } from "@/components/ui/Badge";
import { PageHeader } from "@/components/ui/Card";
import { DifficultyTag } from "@/components/ui/DifficultyTag";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/ui/States";
import { plural } from "@/lib/format";
import { groupSittings, SITTING_GAP_MS, type Sitting } from "./grouping";
import { type SessionRow, useSessions } from "./queries";

/**
 * Sessions bundled into sittings (see grouping.ts). The latest sitting leads the page with its
 * interviews laid out; older sittings collapse to one line each, grouped by how long ago they were.
 */
export function SessionsPage() {
  const sessions = useSessions();
  const sittings = sessions.data ? groupSittings(sessions.data) : [];
  const [latest, ...earlier] = sittings;

  return (
    <div>
      <PageHeader title="Sessions" subtitle="Your practice and mock interviews, by sitting." />
      {sessions.isPending ? (
        <ListSkeleton />
      ) : sessions.isError ? (
        <ErrorState error={sessions.error} onRetry={() => void sessions.refetch()} />
      ) : !latest ? (
        <EmptyState
          icon={<Inbox className="size-7" aria-hidden />}
          title="No sessions yet"
          description="Solve a problem or run a mock interview with the Lare extension and it shows up here."
        />
      ) : (
        <>
          <LatestSitting sitting={latest} />
          {bucket(earlier).map(([heading, group]) => (
            <section key={heading} className="mt-8" aria-label={heading}>
              <h2 className="mb-3 text-sm font-semibold text-[var(--text)]">{heading}</h2>
              <ul className="divide-y divide-[var(--border)] overflow-hidden rounded-[var(--lare-r-4)] border border-[var(--border)] bg-[color-mix(in_oklab,var(--surface-raised)_40%,transparent)]">
                {group.map((sitting) => (
                  <EarlierSitting key={sitting.key} sitting={sitting} />
                ))}
              </ul>
            </section>
          ))}
        </>
      )}
    </div>
  );
}

function LatestSitting({ sitting }: { sitting: Sitting<SessionRow> }) {
  const live = sitting.sessions.some((s) => s.status === "active" || s.status === "paused");
  const recent = Date.now() - sitting.end <= SITTING_GAP_MS;
  return (
    <section
      aria-label="Latest sitting"
      className="rounded-[var(--lare-r-4)] border border-[var(--border)] bg-[color-mix(in_oklab,var(--surface-raised)_40%,transparent)]"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 p-5">
        <div className="min-w-0">
          {live || recent ? (
            // Status pill instead of a different background: green and softly pulsing when current.
            <p className="inline-flex items-center gap-1.5 rounded-full bg-[color-mix(in_oklab,var(--lare-status-run)_18%,transparent)] px-2 py-0.5 text-xs font-medium text-[color-mix(in_oklab,var(--lare-status-run)_70%,var(--lare-bone))]">
              <span className="relative flex size-1.5">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-[var(--lare-status-run)] opacity-60 motion-reduce:hidden" />
                <span className="relative inline-flex size-1.5 rounded-full bg-[var(--lare-status-run)]" />
              </span>
              {live ? "In progress" : "Current session"}
            </p>
          ) : (
            <p className="text-xs font-medium text-[var(--text-secondary)]">Latest session</p>
          )}
          <h2 className="lare-heading mt-1 text-[var(--text)]">{sitting.label}</h2>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">{when(sitting)}</p>
        </div>
        <SittingStats sitting={sitting} />
      </div>

      {sitting.problems.length > 0 ? (
        <div className="border-t border-[var(--border)] px-5 py-4">
          <h3 className="mb-2 text-xs font-medium text-[var(--text-secondary)]">Problems</h3>
          <ul className="flex flex-wrap gap-2">
            {sitting.problems.map((p) => (
              <li
                key={p.slug}
                className="inline-flex items-center gap-2 overflow-hidden rounded-[var(--lare-r-2)] border border-[var(--border)] pr-2.5 text-sm text-[var(--text)]"
              >
                <DifficultyTag difficulty={p.difficulty} />
                {p.title}
                {p.attempts > 1 ? (
                  <span className="tabular-nums text-xs text-[var(--text-tertiary)]">
                    ×{p.attempts}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <SessionRows sessions={sitting.sessions} className="border-t border-[var(--border)]" />
    </section>
  );
}

function EarlierSitting({ sitting }: { sitting: Sitting<SessionRow> }) {
  const [open, setOpen] = useState(false);
  const titles = sitting.problems.map((p) => p.title);
  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-left hover:bg-[color-mix(in_oklab,var(--surface-raised)_60%,transparent)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--focus)]"
      >
        <ChevronRight
          className={`size-4 text-[var(--text-tertiary)] transition-transform ${open ? "rotate-90" : ""}`}
          aria-hidden
        />
        <span className="min-w-0">
          <span className="block truncate text-sm text-[var(--text)]">
            {sitting.label}
            <span className="text-[var(--text-tertiary)]"> · {when(sitting)}</span>
          </span>
          {titles.length > 0 ? (
            <span className="block truncate text-xs text-[var(--text-secondary)]">
              {titles.slice(0, 3).join(", ")}
              {titles.length > 3 ? ` +${titles.length - 3}` : ""}
            </span>
          ) : null}
        </span>
        <span className="text-xs tabular-nums text-[var(--text-secondary)]">
          {plural(sitting.sessions.length, "session")}
        </span>
      </button>
      {open ? (
        <SessionRows
          sessions={sitting.sessions}
          className="border-t border-[var(--border)] bg-[color-mix(in_oklab,var(--surface-raised)_50%,transparent)]"
        />
      ) : null}
    </li>
  );
}

function SittingStats({ sitting }: { sitting: Sitting<SessionRow> }) {
  const items = [
    sitting.interviews ? plural(sitting.interviews, "interview") : null,
    sitting.practices ? plural(sitting.practices, "practice set") : null,
    sitting.activeMs > 0 ? `${formatDurationHuman(sitting.activeMs)} active` : null,
  ].filter(Boolean);
  return <p className="text-sm tabular-nums text-[var(--text-secondary)]">{items.join(" · ")}</p>;
}

/** The individual recordings inside a sitting: time, kind, length, and where it went. */
function SessionRows({ sessions, className }: { sessions: SessionRow[]; className?: string }) {
  return (
    <ul className={`divide-y divide-[var(--border)] ${className ?? ""}`}>
      {sessions.map((s) => (
        <li
          key={s.id}
          className="grid grid-cols-[4.5rem_minmax(0,1fr)_5.5rem] items-center gap-3 px-5 py-2.5 sm:grid-cols-[4.5rem_minmax(0,1fr)_4.5rem_5.5rem]"
        >
          <span className="text-xs tabular-nums text-[var(--text-secondary)]">
            {clock(Date.parse(s.started_at))}
          </span>
          <Link
            to={`/sessions/${s.id}`}
            className="flex min-w-0 items-center gap-2 rounded-[var(--lare-r-1)] focus-visible:outline-2 focus-visible:outline-[var(--focus)]"
          >
            {/* Fixed width so difficulty and title line up whatever the kind. */}
            <span className="flex w-[4.5rem] shrink-0 items-center">
              <KindBadge kind={s.kind} />
            </span>
            {s.session_problems[0] ? (
              <DifficultyTag difficulty={s.session_problems[0].difficulty} rounded />
            ) : null}
            <span className="truncate text-sm text-[var(--text)] hover:underline">
              {s.session_problems[0]?.title ??
                (s.kind === "interview" ? "Mock interview" : "Practice")}
              {s.session_problems.length > 1 ? (
                <span className="text-[var(--text-tertiary)]">
                  {" "}
                  +{s.session_problems.length - 1}
                </span>
              ) : null}
            </span>
            {s.kind === "interview" ? (
              <span className="hidden text-xs text-[var(--text-tertiary)] sm:inline">
                {s.graded ? "Graded" : "Video only"}
              </span>
            ) : null}
          </Link>
          <span className="hidden text-right text-xs tabular-nums text-[var(--text-secondary)] sm:block">
            {s.active_ms > 0 ? formatDurationHuman(s.active_ms) : "—"}
          </span>
          <span className="flex justify-end">
            <SessionAction session={s} />
          </span>
        </li>
      ))}
    </ul>
  );
}

function SessionAction({ session }: { session: SessionRow }) {
  const post = session.posts;
  const live = session.status === "active" || session.status === "paused";
  if (live || session.status === "abandoned") return <SessionStatusBadge status={session.status} />;
  const cls =
    "inline-flex items-center gap-1 whitespace-nowrap text-xs text-[var(--text-secondary)] hover:text-[var(--text)]";
  if (post)
    return post.status === "draft" ? (
      <Link to={`/drafts/${post.id}`} className={cls}>
        Draft
      </Link>
    ) : (
      <Link to={`/posts/${post.id}`} className={cls}>
        Posted <ArrowRight className="size-3" aria-hidden />
      </Link>
    );
  return (
    <Link to={`/sessions/${session.id}`} className={cls}>
      Review
    </Link>
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function clock(t: number): string {
  return new Date(t)
    .toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })
    .toLowerCase();
}

/** "Today · 4:05 – 4:35 am", "Yesterday · …", "Mon 8 Sep · …". */
function when(sitting: Sitting<SessionRow>): string {
  const today = startOfDay(Date.now());
  const day = startOfDay(sitting.start);
  const date =
    day === today
      ? "Today"
      : day === today - DAY_MS
        ? "Yesterday"
        : new Date(sitting.start).toLocaleDateString("en-AU", {
            weekday: "short",
            day: "numeric",
            month: "short",
          });
  const start = clock(sitting.start);
  const end = clock(sitting.end);
  return start === end ? `${date} · ${start}` : `${date} · ${start} – ${end}`;
}

/** Older sittings under "This week", "Last week" and "Earlier", keeping newest-first order. */
function bucket(sittings: Sitting<SessionRow>[]): [string, Sitting<SessionRow>[]][] {
  const today = startOfDay(Date.now());
  const weekStart = today - ((new Date(today).getDay() + 6) % 7) * DAY_MS;
  const out = new Map<string, Sitting<SessionRow>[]>();
  for (const s of sittings) {
    const heading =
      s.start >= weekStart
        ? "This week"
        : s.start >= weekStart - 7 * DAY_MS
          ? "Last week"
          : "Earlier";
    out.set(heading, [...(out.get(heading) ?? []), s]);
  }
  return [...out.entries()];
}
