import { getPendingRequestCount, getUnreadNotificationCount, getViewer } from "@/lib/viewer";
import { SiteChrome } from "./site-chrome";

export async function SiteHeader() {
  const viewer = await getViewer();
  const [pending, unread] = viewer
    ? await Promise.all([getPendingRequestCount(viewer.id), getUnreadNotificationCount()])
    : [0, 0];

  return (
    <SiteChrome
      viewer={
        viewer
          ? {
              id: viewer.id,
              avatarUrl: viewer.profile?.avatar_url ?? null,
              displayName: viewer.profile?.display_name ?? null,
              handle: viewer.profile?.handle ?? null,
            }
          : null
      }
      pending={pending}
      unread={unread}
    />
  );
}
