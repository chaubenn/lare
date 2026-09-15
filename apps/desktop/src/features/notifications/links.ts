import type { NotificationLinks } from "@lare/shared";

export const DESKTOP_NOTIFICATION_LINKS: NotificationLinks = {
  post: (post) => `/posts/${post.id}`,
  profile: (handle) => `/u/${handle}`,
  requests: "/friends?tab=requests",
};
