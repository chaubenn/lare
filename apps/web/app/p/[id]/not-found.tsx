import { Lock } from "lucide-react";
import Link from "next/link";
import { buttonPrimary, buttonSecondary } from "@/lib/styles";
import { getViewer } from "@/lib/viewer";

/**
 * Rendered when the post row isn't visible to the viewer (RLS) or doesn't exist.
 * Anonymous viewers are nudged to sign in since the post may be followers-only.
 */
export default async function PostNotFound() {
  const viewer = await getViewer();

  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <span className="inline-flex size-12 items-center justify-center rounded-full bg-zinc-900 text-zinc-400">
        <Lock className="size-5" />
      </span>
      {viewer ? (
        <>
          <h1 className="mt-4 text-2xl font-semibold text-zinc-50">Post not found</h1>
          <p className="mt-2 text-sm text-zinc-400">
            It may have been deleted or unpublished, or the author only shares it with accepted
            followers.
          </p>
          <Link href="/" className={`${buttonPrimary} mt-6`}>
            Back to feed
          </Link>
        </>
      ) : (
        <>
          <h1 className="mt-4 text-2xl font-semibold text-zinc-50">This post is private</h1>
          <p className="mt-2 text-sm text-zinc-400">
            This post is private or the author only shares with followers. Sign in to see it if you
            follow them.
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <Link href="/login" className={buttonPrimary}>
              Sign in
            </Link>
            <Link href="/" className={buttonSecondary}>
              Home
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
