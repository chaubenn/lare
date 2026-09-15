import { buildActivityDays, difficultySplit, summarizeActivity, topicStats } from "@lare/shared";
import { ArrowRight, Flame } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { DifficultyTag } from "@/components/ui/DifficultyTag";
import { useUser } from "@/features/auth/AuthProvider";
import { useSolvedActivity, useSolvedSkills } from "@/features/profile/queries";
import { GoalPanel } from "@/features/progress/GoalPanel";
import { useDrafts } from "@/features/publishing/drafts/queries";
import type { FeedPost } from "./queries";

const DIFF = [
  { key: "easy", color: "var(--lare-diff-easy)" },
  { key: "medium", color: "var(--lare-diff-medium)" },
  { key: "hard", color: "var(--lare-diff-hard)" },
] as const;

/**
 * The column beside the feed: your own week and skills (the reason to come back), what people on
 * Lare are working on right now, and anything of yours waiting to be posted.
 */
export function FeedSidebar({ posts }: { posts: FeedPost[] }) {
  return (
    <aside className="space-y-4" aria-label="Your progress and what's trending">
      <YourWeek />
      <GoalPanel />
      <DraftsWaiting />
      <YourSkills />
      <Trending posts={posts} />
    </aside>
  );
}

function Panel({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[var(--lare-r-4)] border border-[var(--border)] bg-[var(--surface-raised)] p-4">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-[var(--text)]">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

const linkClass =
  "inline-flex items-center gap-1 text-xs text-[var(--text-secondary)] hover:text-[var(--text)]";

function YourWeek() {
  const { profile } = useUser();
  const activity = useSolvedActivity(profile?.handle);
  if (!activity.data?.visible) return null;
  const days = buildActivityDays(activity.data);
  const summary = summarizeActivity(days);
  const week = days.slice(-7);
  const max = Math.max(1, ...week.map((d) => d.count));
  return (
    <Panel
      title="Your week"
      action={
        <Link to="/profile" className={linkClass}>
          Profile <ArrowRight className="size-3" aria-hidden />
        </Link>
      }
    >
      <div className="flex items-end justify-between gap-4">
        <p>
          <span className="block text-3xl font-semibold leading-none tabular-nums text-[var(--text)]">
            {summary.last7}
          </span>
          <span className="mt-1 block text-xs text-[var(--text-secondary)]">solved in 7 days</span>
        </p>
        <div className="flex h-12 items-end gap-1" aria-hidden>
          {week.map((d, i) => (
            <span
              key={d.iso}
              className="w-2.5 rounded-sm"
              style={{
                height: `${d.count === 0 ? 8 : 20 + (d.count / max) * 80}%`,
                background:
                  i === week.length - 1
                    ? "var(--accent)"
                    : d.count === 0
                      ? "var(--border)"
                      : "var(--border-strong)",
              }}
            />
          ))}
        </div>
      </div>
      <p className="mt-3 flex items-center gap-1.5 border-t border-[var(--border)] pt-3 text-xs text-[var(--text-secondary)]">
        <Flame
          className="size-3.5"
          style={{ color: summary.streak > 0 ? "var(--lare-diff-medium)" : "var(--text-tertiary)" }}
          aria-hidden
        />
        {summary.streak > 0 ? `${summary.streak}-day streak` : "Solve one today to start a streak"}
      </p>
    </Panel>
  );
}

function DraftsWaiting() {
  const drafts = useDrafts();
  const count = drafts.data?.length ?? 0;
  if (count === 0) return null;
  return (
    <Link
      to="/drafts"
      className="flex items-center justify-between gap-3 rounded-[var(--lare-r-4)] border border-[var(--border)] bg-[var(--surface-raised)] px-4 py-3 text-sm text-[var(--text)] transition-colors hover:border-[var(--border-strong)]"
    >
      <span>
        <span className="font-semibold tabular-nums">{count}</span>{" "}
        {count === 1 ? "draft" : "drafts"} ready to post
      </span>
      <ArrowRight className="size-4 text-[var(--text-secondary)]" aria-hidden />
    </Link>
  );
}

function YourSkills() {
  const { profile } = useUser();
  const skills = useSolvedSkills(profile?.handle);
  if (!skills.data?.visible || skills.data.problems.length === 0) return null;
  const split = difficultySplit(skills.data);
  const topics = topicStats(skills.data).slice(0, 4);
  return (
    <Panel title="Your skills">
      <div className="flex h-2 gap-0.5 overflow-hidden rounded-full" aria-hidden>
        {DIFF.map((d) =>
          split[d.key] > 0 ? (
            <span key={d.key} style={{ flexGrow: split[d.key], background: d.color }} />
          ) : null,
        )}
      </div>
      <p className="mt-2 text-xs tabular-nums text-[var(--text-secondary)]">
        {split.easy} easy · {split.medium} medium · {split.hard} hard
      </p>
      <ul className="mt-3 space-y-1.5 border-t border-[var(--border)] pt-3">
        {topics.map((t) => (
          <li key={t.slug} className="flex items-center justify-between gap-3 text-sm">
            <span className="truncate text-[var(--text)]">{t.name}</span>
            <span className="tabular-nums text-[var(--text-secondary)]">{t.total}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/** Problems appearing most across the posts on screen, so the column matches the feed. */
function Trending({ posts }: { posts: FeedPost[] }) {
  const counts = new Map<string, { title: string; difficulty: string | null; posts: number }>();
  for (const post of posts) {
    const seen = new Set<string>();
    for (const p of post.sessions?.session_problems ?? []) {
      if (seen.has(p.slug)) continue;
      seen.add(p.slug);
      const entry = counts.get(p.slug) ?? { title: p.title, difficulty: p.difficulty, posts: 0 };
      entry.posts += 1;
      counts.set(p.slug, entry);
    }
  }
  const trending = [...counts.entries()].sort((a, b) => b[1].posts - a[1].posts).slice(0, 5);
  if (trending.length === 0) return null;
  return (
    <Panel title="Popular problems">
      <ul className="space-y-2">
        {trending.map(([slug, p]) => (
          <li key={slug} className="flex items-center gap-2 text-sm">
            <DifficultyTag difficulty={p.difficulty} rounded />
            <span className="min-w-0 flex-1 truncate text-[var(--text)]">{p.title}</span>
            <span className="shrink-0 text-xs tabular-nums text-[var(--text-secondary)]">
              {p.posts} {p.posts === 1 ? "post" : "posts"}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
