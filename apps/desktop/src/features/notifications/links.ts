import type { NotificationLinks } from "@lare/shared";
import { routes } from "@/lib/routes";

export const DESKTOP_NOTIFICATION_LINKS: NotificationLinks = {
  post: (post) => routes.post(post.id),
  profile: (handle) => routes.user(handle),
  requests: routes.followRequests,
};
