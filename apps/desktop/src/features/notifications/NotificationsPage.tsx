import { type AppNotification, describeNotification, notificationActorName } from "@lare/shared";
import { cn } from "@lare/ui";
import { Progress } from "@lare/ui/primitives";
import { Bell, CircleAlert, CircleCheck, Info, LoaderCircle, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { Link } from "react-router";
import { Avatar } from "@/components/ui/Avatar";
import { PageHeader } from "@/components/ui/Card";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/ui/States";
import { isActive, type Job, STAGE_LABEL, useJobs } from "@/features/media/jobs";
import { timeAgo } from "@/lib/format";
import { DESKTOP_NOTIFICATION_LINKS } from "./links";
import { dismissNotice, markNoticesRead, type Notice, useNotices } from "./notices";
import { useMarkNotificationsRead, useNotifications } from "./queries";

/**
 * Everything the app has to say, in one place: what is happening right now, what the app needed to
 * tell you, and what other people did. Before this there were four places to look — a toast that
 * had already vanished, a banner above the page, a tray above the status bar, and red text inside
 * Settings — and which one you got depended on which part of the app was speaking.
 */
export function NotificationsPage() {
  const list = useNotifications();
  const notices = useNotices();
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

  const noticesOnOpen = useRef<Set<string> | null>(null);
  if (noticesOnOpen.current === null) {
    noticesOnOpen.current = new Set(notices.filter((n) => n.readAt === null).map((n) => n.id));
  }
  // Same shape as the social half above: anything that arrives while the page is open is read too,
  // so the badge does not tick up under your eyes.
  const unreadNotices = notices.filter((n) => n.readAt === null).length;
  useEffect(() => {
    if (unreadNotices > 0) markNoticesRead();
  }, [unreadNotices]);

  const running = jobs.filter(isActive);

  return (
    <>
      <PageHeader
        title="Notifications"
        subtitle="What the app is doing, what it needs from you, and what people did on your account."
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

      {notices.length > 0 ? (
        <section className="mb-4">
          <h2 className="mb-2 text-xs font-medium text-[var(--text-tertiary)]">From Lare</h2>
          <ul className="divide-y divide-[var(--border)] overflow-hidden rounded-[var(--lare-r-4)] border border-[var(--border)] bg-[color-mix(in_oklab,var(--surface-raised)_40%,transparent)]">
            {notices.map((notice) => (
              <NoticeRow
                key={notice.id}
                notice={notice}
                unread={noticesOnOpen.current?.has(notice.id) ?? false}
              />
            ))}
          </ul>
        </section>
      ) : null}

      <h2 className="mb-2 text-xs font-medium text-[var(--text-tertiary)]">From people</h2>
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

const TONE_ICON = {
  info: <Info className="size-4 shrink-0 text-[var(--lare-info)]" aria-hidden />,
  success: <CircleCheck className="size-4 shrink-0 text-[var(--lare-status-run)]" aria-hidden />,
  error: <CircleAlert className="size-4 shrink-0 text-[var(--lare-danger)]" aria-hidden />,
};

function NoticeRow({ notice, unread }: { notice: Notice; unread: boolean }) {
  const row = "flex items-center gap-3 px-4 py-3";
  const body = (
    <>
      {TONE_ICON[notice.tone]}
      <div className="min-w-0 flex-1">
        <p className="text-sm text-[var(--text)]">{notice.title}</p>
        {notice.description ? (
          <p className="text-xs text-[var(--text-tertiary)]">{notice.description}</p>
        ) : null}
        <p className="text-xs text-[var(--text-tertiary)]">{timeAgo(notice.createdAt)}</p>
      </div>
      {unread ? (
        <span className="size-2 shrink-0 rounded-full bg-[var(--accent)]">
          <span className="sr-only">Unread</span>
        </span>
      ) : null}
    </>
  );
  return (
    <li className="flex items-center">
      {notice.href ? (
        <Link
          to={notice.href}
          className={cn(row, "min-w-0 flex-1 transition-colors hover:bg-[var(--surface-raised)]")}
        >
          {body}
        </Link>
      ) : (
        <div className={cn(row, "min-w-0 flex-1")}>{body}</div>
      )}
      <button
        type="button"
        aria-label={`Dismiss: ${notice.title}`}
        title="Dismiss"
        onClick={() => dismissNotice(notice.id)}
        className="mr-2 shrink-0 rounded p-1 text-[var(--text-tertiary)] transition-colors hover:text-[var(--text)]"
      >
        <X className="size-3.5" aria-hidden />
      </button>
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
