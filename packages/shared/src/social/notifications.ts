/**
 * Notifications about likes, comments and follows. Rows are written by database triggers and
 * read by their recipient; this module parses the joined rows and turns them into copy and a
 * link. Each app passes its own routes, since desktop and web address posts differently.
 */
import { z } from "zod";

export const NOTIFICATION_TYPES = [
  "post_like",
  "post_comment",
  "follow",
  "follow_request",
  "follow_accepted",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** Columns plus the actor and post, for `supabase.from("notifications").select(…)`. */
export const NOTIFICATION_SELECT =
  "id, type, created_at, read_at, actor:profiles!notifications_actor_id_fkey(handle, display_name, avatar_url), post:posts!notifications_post_id_fkey(id, slug, title)";

const ActorSchema = z.object({
  handle: z.string().nullable(),
  display_name: z.string().nullable(),
  avatar_url: z.string().nullable(),
});
export type NotificationActor = z.infer<typeof ActorSchema>;

export const NotificationSchema = z.object({
  id: z.string(),
  type: z.enum(NOTIFICATION_TYPES),
  created_at: z.string(),
  read_at: z.string().nullable(),
  actor: ActorSchema.nullable(),
  post: z.object({ id: z.string(), slug: z.string(), title: z.string().nullable() }).nullable(),
});
export type AppNotification = z.infer<typeof NotificationSchema>;

export function parseNotifications(value: unknown): AppNotification[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    const parsed = NotificationSchema.safeParse(row);
    return parsed.success ? [parsed.data] : [];
  });
}

export interface NotificationLinks {
  post: (post: { id: string; slug: string }) => string;
  profile: (handle: string) => string;
  requests: string;
}

export function notificationActorName(actor: NotificationActor | null): string {
  const display = actor?.display_name?.trim();
  if (display) return display;
  return actor?.handle ? `@${actor.handle}` : "Someone";
}

export function describeNotification(
  notification: AppNotification,
  links: NotificationLinks,
): { text: string; href: string | null } {
  const name = notificationActorName(notification.actor);
  const profileHref = notification.actor?.handle ? links.profile(notification.actor.handle) : null;
  const postHref = notification.post ? links.post(notification.post) : null;
  const titled = notification.post?.title ? ` “${notification.post.title}”` : "";

  switch (notification.type) {
    case "post_like":
      return { text: `${name} liked your post${titled}`, href: postHref };
    case "post_comment":
      return { text: `${name} commented on your post${titled}`, href: postHref };
    case "follow":
      return { text: `${name} started following you`, href: profileHref };
    case "follow_request":
      return { text: `${name} requested to follow you`, href: links.requests };
    case "follow_accepted":
      return { text: `${name} accepted your follow request`, href: profileHref };
  }
}
