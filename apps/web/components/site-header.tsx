import { getPendingRequestCount, getViewer } from "@/lib/viewer";
import { SiteChrome } from "./site-chrome";

export async function SiteHeader() {
  const viewer = await getViewer();
  const pending = viewer ? await getPendingRequestCount(viewer.id) : 0;

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
    />
  );
}
