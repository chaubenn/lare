import { Monitor, Video } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, SectionTitle } from "@/components/ui/Card";

/**
 * Placeholder for the recording feature.
 *
 * TODO(recording): wire "Record (Instant)" / "Record (Studio)" to the Rust recorder
 * (see src-tauri/src/recording.rs::RecordingBackend), create a `videos` row, upload to Bunny,
 * and set `posts.video_id` + `posts.video_kind` on the draft.
 */
export function DemoVideoPanel() {
  return (
    <Card>
      <SectionTitle>Demo video</SectionTitle>
      <p className="text-sm text-zinc-400">
        Record a quick walkthrough of your solution and attach it to the post.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button disabled icon={<Video className="size-4" aria-hidden />} title="Recording arrives in the next build">
          Record (Instant)
        </Button>
        <Button disabled icon={<Monitor className="size-4" aria-hidden />} title="Recording arrives in the next build">
          Record (Studio)
        </Button>
      </div>
      <p className="mt-2 text-xs text-zinc-500">Recording arrives in the next build.</p>
    </Card>
  );
}
