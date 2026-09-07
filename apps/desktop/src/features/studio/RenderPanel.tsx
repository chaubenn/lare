import { Progress } from "@lare/ui/primitives";
import { Clapperboard } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { Card, SectionTitle } from "@/components/ui/Card";
import { Input, Label } from "@/components/ui/Field";
import type { Job } from "@/features/recording/jobs";
import type { StudioProjectInfo } from "@/lib/recorder";

export function StudioRenderPanel({ job }: { job: Job }) {
  return (
    <Card className="space-y-2">
      <p className="text-sm text-zinc-200">{job.label}</p>
      <p className="text-xs text-zinc-500">{job.detail ?? "Working…"}</p>
      {job.percent !== null ? <Progress value={job.percent} label={job.label} /> : null}
      <p className="text-xs text-zinc-500">
        Rendering runs at roughly real-time speed; uploading depends on your connection.
      </p>
    </Card>
  );
}

export function StudioPublishCard({
  title,
  onTitleChange,
  attach,
}: {
  title: string;
  onTitleChange: (value: string) => void;
  attach: { postId: string; title: string | null; status: string } | null | undefined;
}) {
  return (
    <Card className="space-y-3">
      <SectionTitle>Publish</SectionTitle>
      <div>
        <Label htmlFor="studio-title">Video title</Label>
        <Input
          id="studio-title"
          className="mt-1"
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          maxLength={120}
        />
      </div>
      <p className="text-xs text-zinc-500">
        {attach ? (
          <>
            Attaches to{" "}
            <Link
              to={
                attach.status === "draft" ? `/drafts/${attach.postId}` : `/posts/${attach.postId}`
              }
              className="text-emerald-400 hover:underline"
            >
              {attach.title ?? "your post"}
            </Link>
            .
          </>
        ) : (
          "Not linked to a post — the video will be in your library (Recordings)."
        )}
      </p>
    </Card>
  );
}

export function StudioProjectCard({ info }: { info: StudioProjectInfo }) {
  return (
    <Card>
      <SectionTitle>Project</SectionTitle>
      <dl className="space-y-1 text-xs text-zinc-500">
        <Row label="Display" value={info.displayPath ? "yes" : "missing"} />
        <Row label="Camera" value={info.cameraPath ? "yes" : "no"} />
        <Row label="Microphone" value={info.micPath ? "yes" : "no"} />
      </dl>
      <p className="mt-2 flex items-center gap-1 text-[11px] text-zinc-600">
        <Clapperboard className="size-3" aria-hidden />
        Rendered with Cap's exporter.
      </p>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-2">
      <dt>{label}</dt>
      <dd className="text-zinc-300">{value}</dd>
    </div>
  );
}
