import {
  describeNotification,
  NOTIFICATION_SELECT,
  type NotificationLinks,
  notificationActorName,
  parseNotifications,
} from "@lare/shared";
import { Card, Container, PageHeader } from "@lare/ui/primitives";
import { Bell } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Avatar } from "@/components/avatar";
import { timeAgo } from "@/components/person-card";
import { createClient } from "@/lib/supabase/server";
import { requireViewer } from "@/lib/viewer";

export const metadata: Metadata = { title: "Notifications" };

const LINKS: NotificationLinks = {
  post: (post) => `/p/${post.slug}`,
  profile: (handle) => `/u/${handle}`,
  requests: "/friends?tab=requests",
};

export default async function NotificationsPage() {
  await requireViewer("/notifications");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notifications")
    .select(NOTIFICATION_SELECT)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(`Couldn't load notifications: ${error.message}`);

  const items = parseNotifications(data);
  const unread = items.filter((n) => !n.read_at).map((n) => n.id);
  // Rendered with their unread dots, then marked read; the nav count catches up on the next page.
  if (unread.length > 0) await supabase.rpc("mark_notifications_read", { ids: unread });

  return (
    <Container width="page">
      <PageHeader title="Notifications" subtitle="Likes, comments and follows on your account." />
      {items.length === 0 ? (
        <Card className="px-6 py-12 text-center">
          <Bell className="mx-auto size-8 text-[var(--text-tertiary)]" aria-hidden />
          <p className="mx-auto mt-3 max-w-sm text-sm text-[var(--text-secondary)]">
            Nothing yet. Likes, comments and new followers show up here.
          </p>
        </Card>
      ) : (
        <ul className="divide-y divide-[var(--border)] overflow-hidden rounded-[var(--lare-r-4)] border border-[var(--border)] bg-[color-mix(in_oklab,var(--surface-raised)_40%,transparent)]">
          {items.map((n) => {
            const { text, href } = describeNotification(n, LINKS);
            const row = "flex items-center gap-3 px-4 py-3";
            const body = (
              <>
                <Avatar
                  src={n.actor?.avatar_url ?? null}
                  name={notificationActorName(n.actor)}
                  size="sm"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-[var(--text)]">{text}</p>
                  <p className="text-xs text-[var(--text-tertiary)]">{timeAgo(n.created_at)}</p>
                </div>
                {n.read_at ? null : (
                  <span className="size-2 shrink-0 rounded-full bg-[var(--accent)]">
                    <span className="sr-only">Unread</span>
                  </span>
                )}
              </>
            );
            return (
              <li key={n.id}>
                {href ? (
                  <Link
                    href={href}
                    className={`${row} transition-colors hover:bg-[var(--surface-raised)]`}
                  >
                    {body}
                  </Link>
                ) : (
                  <div className={row}>{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Container>
  );
}
