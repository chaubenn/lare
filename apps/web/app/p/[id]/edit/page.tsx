import { Container, PageHeader } from "@lare/ui/primitives";
import { ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getPostDetail } from "@/lib/posts";
import { getViewer } from "@/lib/viewer";
import { EditPost } from "./edit-post";

type Params = { params: Promise<{ id: string }> };

export const metadata: Metadata = { title: "Edit post", robots: { index: false, follow: false } };

/** `/p/<slug>/edit`: the owner's editor on its own page, away from the post itself. */
export default async function EditPostPage({ params }: Params) {
  const { id } = await params;
  const [post, viewer] = await Promise.all([getPostDetail(id), getViewer()]);
  if (!viewer) redirect(`/login?next=${encodeURIComponent(`/p/${id}/edit`)}`);
  if (!post || post.user_id !== viewer.id) notFound();
  if (id !== post.slug) redirect(`/p/${post.slug}/edit`);

  const title = post.title?.trim() || "Untitled session";

  return (
    <Container width="page">
      <Link
        href={`/p/${post.slug}`}
        className="mb-3 inline-flex items-center gap-1 text-sm text-[var(--text-secondary)] hover:text-[var(--text)]"
      >
        <ChevronLeft className="size-4" aria-hidden />
        Post
      </Link>
      <PageHeader title="Edit post" subtitle={title} />
      <EditPost
        postSlug={post.slug}
        status={post.status}
        postId={post.id}
        userId={viewer.id}
        title={post.title ?? ""}
        body={post.body ?? ""}
        visibility={post.visibility}
        showVideo={post.show_video}
        showDemoVideo={post.show_demo_video}
        includeAiInsights={post.include_ai_insights}
        includeOgCard={post.include_og_card}
        ogShowAiScores={post.og_show_ai_scores}
        hasVideo={Boolean(post.videos) && post.video_kind !== "none"}
        hasDemoVideo={Boolean(post.demo_videos)}
        isInterview={post.sessions?.kind === "interview"}
        coverMediaId={post.cover_media_id}
        images={post.images}
      />
    </Container>
  );
}
