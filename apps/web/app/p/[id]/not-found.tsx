import { buttonClass, Container } from "@lare/ui/primitives";
import { Lock } from "lucide-react";
import Link from "next/link";
import { getViewer } from "@/lib/viewer";

/**
 * Rendered when the post row isn't visible to the viewer (RLS) or doesn't exist.
 * Anonymous viewers are nudged to sign in since the post may be followers-only.
 */
export default async function PostNotFound() {
  const viewer = await getViewer();

  return (
    <Container width="prose" className="py-16 text-center">
      <span className="inline-flex size-12 items-center justify-center rounded-full bg-[var(--surface-raised)] text-[var(--text-tertiary)]">
        <Lock className="size-5" />
      </span>
      {viewer ? (
        <>
          <h1 className="lare-title mt-4 text-[var(--text)]">Post not found</h1>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            It may have been deleted or unpublished, or the author only shares it with accepted
            followers.
          </p>
          <Link href="/" className={`${buttonClass("primary")} mt-6`}>
            Back to feed
          </Link>
        </>
      ) : (
        <>
          <h1 className="lare-title mt-4 text-[var(--text)]">This post is private</h1>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            This post is private or the author only shares with followers. Sign in to see it if you
            follow them.
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <Link href="/login" className={buttonClass("primary")}>
              Sign in
            </Link>
            <Link href="/" className={buttonClass("secondary")}>
              Home
            </Link>
          </div>
        </>
      )}
    </Container>
  );
}
