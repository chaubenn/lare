import { type AppNotification, describeNotification, notificationActorName } from "@lare/shared";
import { Progress } from "@lare/ui/primitives";
import { Bell, LoaderCircle } from "lucide-react";
import { useEffect, useRef } from "react";
import { Link } from "react-router";
import { Avatar } from "@/components/ui/Avatar";
import { PageHeader } from "@/components/ui/Card";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/ui/States";
import { isActive, type Job, STAGE_LABEL, useJobs } from "@/features/media/jobs";
import { timeAgo } from "@/lib/format";
import { DESKTOP_NOTIFICATION_LINKS } from "./links";
import { useMarkNotificationsRead, useNotifications } from "./queries";

/**
 * What other people did — likes, comments, replies, mentions, follows — plus the background work
 * still running. The app's own alerts are toasts in the corner (`Toaster`), not rows here.
 */
export function NotificationsPage() {
  const list = useNotifications();
  const jobs = useJobs();
  const { mutate: markRead } = useMarkNotificationsRead();
  // What was unread when the page opened, so the dots stay while the rows are marked read.
  const unreadOnOpen = useRef<Set<string> | null>(null);
  const items = list.data;

  useEffect(() => {
    if (!items) return;
    const unread = items.filter((n) => !n.read_at).map((n) => n.id);
    if (unreadOnOpen.current === null) unreadOnOpen.current = new Set(unread);
    if (unread.length > 0) markRead(unread);
  }, [items, markRead]);

  const running = jobs.filter(isActive);

  return (
    <>
      <PageHeader
        title="Notifications"
        subtitle="What people did on your account, and what the app is working on."
      />

      {running.length > 0 ? (
        <section className="mb-4">
          <h2 className="mb-2 text-xs font-medium text-[var(--text-tertiary)]">In progress</h2>
          <ul className="divide-y divide-[var(--border)] overflow-hidden rounded-[var(--lare-r-4)] border border-[var(--border)] bg-[color-mix(in_oklab,var(--surface-raised)_40%,transparent)]">
            {running.map((job) => (
              <JobRow key={job.id} job={job} />
            ))}
          </ul>
        </section>
      ) : null}

      {running.length > 0 ? (
        <h2 className="mb-2 text-xs font-medium text-[var(--text-tertiary)]">From people</h2>
      ) : null}
      <NotificationsBody
        isPending={list.isPending}
        error={list.error}
        items={items}
        onRetry={() => void list.refetch()}
        isUnread={(n) => !n.read_at || (unreadOnOpen.current?.has(n.id) ?? false)}
      />
    </>
  );
}

function JobRow({ job }: { job: Job }) {
  return (
    <li className="flex items-center gap-3 px-4 py-3 text-sm">
      <LoaderCircle className="size-4 shrink-0 animate-spin text-[var(--lare-info)]" aria-hidden />
      <span className="shrink-0 font-medium text-[var(--text)]">{job.label}</span>
      <span className="min-w-0 flex-1 truncate text-xs text-[var(--text-tertiary)]">
        {job.detail ?? STAGE_LABEL[job.stage]}
      </span>
      {job.percent !== null ? (
        <Progress
          value={job.percent}
          label={`${job.label} progress`}
          className="h-1.5 w-32 shrink-0"
        />
      ) : null}
    </li>
  );
}

function NotificationsBody({
  isPending,
  error,
  items,
  onRetry,
  isUnread,
}: {
  isPending: boolean;
  error: Error | null;
  items: AppNotification[] | undefined;
  onRetry: () => void;
  isUnread: (n: AppNotification) => boolean;
}) {
  if (isPending) return <ListSkeleton />;
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (!items || items.length === 0) {
    return (
      <EmptyState
        icon={<Bell className="size-8" aria-hidden />}
        title="Nothing yet"
        description="Likes, comments and new followers show up here."
      />
    );
  }
  return (
    <ul className="divide-y divide-[var(--border)] overflow-hidden rounded-[var(--lare-r-4)] border border-[var(--border)] bg-[color-mix(in_oklab,var(--surface-raised)_40%,transparent)]">
      {items.map((n) => (
        <NotificationItem key={n.id} notification={n} unread={isUnread(n)} />
      ))}
    </ul>
  );
}

function NotificationItem({
  notification,
  unread,
}: {
  notification: AppNotification;
  unread: boolean;
}) {
  const { text, href } = describeNotification(notification, DESKTOP_NOTIFICATION_LINKS);
  const name = notificationActorName(notification.actor);
  const row = "flex items-center gap-3 px-4 py-3";
  const body = (
    <>
      <Avatar url={notification.actor?.avatar_url ?? null} name={name} size={36} />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-[var(--text)]">{text}</p>
        <p className="text-xs text-[var(--text-tertiary)]">{timeAgo(notification.created_at)}</p>
      </div>
      {unread ? (
        <span className="size-2 shrink-0 rounded-full bg-[var(--accent)]">
          <span className="sr-only">Unread</span>
        </span>
      ) : null}
    </>
  );
  return (
    <li>
      {href ? (
        <Link to={href} className={`${row} transition-colors hover:bg-[var(--surface-raised)]`}>
          {body}
        </Link>
      ) : (
        <div className={row}>{body}</div>
      )}
    </li>
  );
}
