import Link from "next/link";
import { getPendingRequestCount, getViewer } from "@/lib/viewer";
import { AvatarMenu } from "./avatar-menu";

export async function SiteHeader() {
  const viewer = await getViewer();
  const pending = viewer ? await getPendingRequestCount(viewer.id) : 0;

  return (
    <header className="sticky top-0 z-30 border-b border-zinc-900 bg-zinc-950/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-3xl items-center justify-between gap-4 px-4">
        <div className="flex items-center gap-5">
          <Link href="/" className="text-lg font-bold tracking-tight text-zinc-50">
            Lare
          </Link>
          {viewer && (
            <nav className="flex items-center gap-4 text-sm text-zinc-400">
              <Link href="/" className="hover:text-zinc-100">
                Feed
              </Link>
              <Link
                href="/friends"
                className="inline-flex items-center gap-1.5 hover:text-zinc-100"
              >
                Friends
                {pending > 0 && (
                  <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-amber-500 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-zinc-950">
                    {pending > 99 ? "99+" : pending}
                  </span>
                )}
              </Link>
            </nav>
          )}
        </div>

        {viewer ? (
          <AvatarMenu
            avatarUrl={viewer.profile?.avatar_url ?? null}
            displayName={viewer.profile?.display_name ?? null}
            handle={viewer.profile?.handle ?? null}
          />
        ) : (
          <Link
            href="/login"
            className="rounded-lg bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-950 hover:bg-white"
          >
            Sign in
          </Link>
        )}
      </div>
    </header>
  );
}
