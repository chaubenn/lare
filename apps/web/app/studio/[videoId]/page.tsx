import { Card, Container, PageHeader } from "@lare/ui/primitives";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RefreshWorkspace } from "@/components/refresh-workspace";
import { VideoEmbed } from "@/components/video-embed";
import { GITHUB_RELEASES_URL } from "@/lib/env";
import { isUuid } from "@/lib/post-utils";
import { createClient } from "@/lib/supabase/server";
import { requireViewer } from "@/lib/viewer";

export default async function StudioPage({ params }: { params: Promise<{ videoId: string }> }) {
  const { videoId } = await params;
  const viewer = await requireViewer(`/studio/${videoId}`);
  if (!isUuid(videoId)) notFound();
  const supabase = await createClient();
  const { data: video, error } = await supabase
    .from("videos")
    .select("*")
    .eq("id", videoId)
    .eq("user_id", viewer.id)
    .maybeSingle();
  if (error) throw error;
  if (!video) notFound();
  return (
    <Container width="page" className="space-y-5">
      <PageHeader title="Video studio" />
      <RefreshWorkspace />
      <VideoEmbed
        videoId={video.id}
        status={video.status}
        bunnyVideoId={video.bunny_video_id}
        durationMs={video.duration_ms}
      />
      <Card className="space-y-3 p-5 text-sm">
        <h2 className="text-lg font-medium">Trim in the desktop studio</h2>
        <p>
          The browser can record, upload and play video, but it does not have the native studio
          renderer. No trim has been applied to this video.
        </p>
        <p>
          Open this video from your draft or session in the desktop app. Trimming requires an
          available source or local studio project; older recordings may no longer have one after
          upload. Unedited videos do not need a render.
        </p>
        <p className="break-all text-[var(--text-tertiary)]">Video ID: {video.id}</p>
        <a
          href={GITHUB_RELEASES_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-block underline"
        >
          Get the desktop app
        </a>
      </Card>
      <div className="flex gap-4 text-sm">
        <Link href="/drafts" className="underline">
          Back to drafts
        </Link>
        {video.session_id && (
          <Link href={`/sessions/${video.session_id}`} className="underline">
            Back to session
          </Link>
        )}
      </div>
    </Container>
  );
}
