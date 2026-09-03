/**
 * /recordings — every recording still on disk (newest first) with the pipeline state we track
 * locally (uploaded / transcribed / last error) and the actions to finish, inspect or remove it.
 */

import { formatDurationHuman } from "@lare/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ask } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  Camera,
  Clapperboard,
  FolderOpen,
  ListChecks,
  LoaderCircle,
  Mic,
  MicOff,
  Play,
  RefreshCw,
  Scissors,
  SquarePen,
  Trash2,
  Upload,
  Video,
} from "lucide-react";
import { Link } from "react-router";
import { useToast } from "@/components/toast/ToastProvider";
import { Badge } from "@/components/ui/Badge";
import { Button, type ButtonProps } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/Card";
import { EmptyState, ErrorState, PageSpinner } from "@/components/ui/States";
import { useUser } from "@/features/auth/AuthProvider";
import { type RecordingWithMeta, recordingsKey, useRecordings } from "@/features/recording/hooks";
import { isActive, type Job, STAGE_LABEL, useJobs } from "@/features/recording/jobs";
import { processInterview, publishInstantDemo } from "@/features/recording/pipeline";
import { forgetRecording } from "@/features/recording/recordingStore";
import { formatDateTime } from "@/lib/format";
import { baseName, recorder } from "@/lib/recorder";
import { errorMessage } from "@/lib/supabase";
import { inTauri } from "@/lib/tauri";

const IS_WINDOWS = typeof navigator !== "undefined" && navigator.platform.includes("Win");
const FILE_MANAGER = IS_WINDOWS ? "Explorer" : "Finder";
const SUBTITLE = `Recordings stay on this ${IS_WINDOWS ? "PC" : "Mac"} until you delete them. Upload, resume processing or open them in the editor from here.`;

export function RecordingsPage() {
  const queryClient = useQueryClient();
  const recordings = useRecordings();
  const jobs = useJobs();

  if (!inTauri) {
    return (
      <>
        <PageHeader title="Recordings" subtitle={SUBTITLE} />
        <EmptyState
          icon={<Video className="size-8" aria-hidden />}
          title="Desktop app only"
          description="Recordings are only available in the Lare desktop app."
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Recordings"
        subtitle={SUBTITLE}
        actions={
          <Button
            size="sm"
            variant="ghost"
            icon={<RefreshCw className="size-3.5" aria-hidden />}
            loading={recordings.isRefetching}
            onClick={() => void queryClient.invalidateQueries({ queryKey: recordingsKey })}
          >
            Refresh
          </Button>
        }
      />
      {recordings.isPending ? (
        <PageSpinner />
      ) : recordings.isError ? (
        <ErrorState error={recordings.error} onRetry={() => void recordings.refetch()} />
      ) : recordings.data.length === 0 ? (
        <EmptyState
          icon={<Clapperboard className="size-8" aria-hidden />}
          title="No recordings yet"
          description={
            <>
              Demo videos are recorded from a{" "}
              <Link to="/drafts" className="text-emerald-400 hover:underline">
                draft
              </Link>{" "}
              (Instant or Studio). Mock interviews are recorded when you start one from the Chrome
              extension.
            </>
          }
        />
      ) : (
        <ul className="space-y-3">
          {[...recordings.data]
            .sort((a, b) => b.endedAt - a.endedAt)
            .map((rec) => (
              <li key={rec.recordingId}>
                <RecordingRow
                  recording={rec}
                  job={jobs.find((j) => j.recordingId === rec.recordingId && isActive(j))}
                />
              </li>
            ))}
        </ul>
      )}
    </>
  );
}

function RecordingRow({
  recording: rec,
  job,
}: {
  recording: RecordingWithMeta;
  /** Active pipeline job for this recording, if any. */
  job: Job | undefined;
}) {
  const { userId } = useUser();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: recordingsKey });

  const isInterview = rec.purpose === "interview";
  const hasEditor = rec.mode === "studio" || isInterview;
  const canUpload = !isInterview && rec.mode === "instant" && !rec.uploaded && !!rec.outputMp4;
  const canProcess = isInterview && !rec.uploaded;
  const editorHref = `/studio/${rec.recordingId}${rec.postId ? `?post=${rec.postId}` : ""}`;
  const path = rec.outputMp4 ?? rec.projectPath;

  const uploadDemo = useMutation({
    mutationFn: () =>
      publishInstantDemo({
        recording: rec,
        userId,
        postId: rec.postId,
        title: "Demo video",
        queryClient,
      }),
    onSuccess: () =>
      toast({
        title: "Demo video uploaded",
        description: rec.postId
          ? "Attached to the draft — Bunny is processing it."
          : "Bunny is processing it.",
        variant: "success",
      }),
    onError: (e) =>
      toast({ title: "Upload failed", description: errorMessage(e), variant: "error" }),
    onSettled: invalidate,
  });

  const processRecording = useMutation({
    mutationFn: () =>
      processInterview({
        recording: rec,
        userId,
        queryClient,
        resume: { transcribed: rec.transcribed, exportPath: rec.exportPath, videoId: rec.videoId },
      }),
    onSuccess: () =>
      toast({
        title: "Mock interview processed",
        description: "The video is uploaded — Bunny is processing it.",
        variant: "success",
      }),
    onError: (e) =>
      toast({ title: "Processing failed", description: errorMessage(e), variant: "error" }),
    onSettled: invalidate,
  });

  const deleteRecording = useMutation({
    mutationFn: async () => {
      await recorder.delete(rec.recordingId);
      await forgetRecording(rec.recordingId);
    },
    onSuccess: async () => {
      await invalidate();
      toast({ title: "Recording deleted" });
    },
    onError: (e) =>
      toast({
        title: "Couldn't delete the recording",
        description: errorMessage(e),
        variant: "error",
      }),
  });

  const confirmDelete = async () => {
    const ok = await ask("Delete this recording from disk? Uploaded videos are not affected.", {
      title: "Delete recording",
      kind: "warning",
      okLabel: "Delete",
      cancelLabel: "Keep",
    });
    if (ok) deleteRecording.mutate();
  };

  const reveal = async () => {
    try {
      await revealItemInDir(path);
    } catch (e) {
      toast({
        title: `Couldn't show it in ${FILE_MANAGER}`,
        description: errorMessage(e),
        variant: "error",
      });
    }
  };

  const busy =
    job !== undefined ||
    uploadDemo.isPending ||
    processRecording.isPending ||
    deleteRecording.isPending;

  return (
    <article className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
        {isInterview ? <Badge tone="violet">Mock interview</Badge> : <Badge tone="sky">Demo</Badge>}
        <Badge>{rec.mode}</Badge>
        <span>{formatDateTime(new Date(rec.endedAt).toISOString())}</span>
        <span aria-hidden>·</span>
        <span>{formatDurationHuman(Math.max(0, rec.endedAt - rec.startedAt))}</span>
        {rec.facecam ? (
          <>
            <span aria-hidden>·</span>
            <span className="inline-flex items-center gap-1">
              <Camera className="size-3.5" aria-hidden />
              Facecam
            </span>
          </>
        ) : null}
        {rec.micTrack ? (
          <>
            <span aria-hidden>·</span>
            <span className="inline-flex items-center gap-1">
              <Mic className="size-3.5" aria-hidden />
              Mic track
            </span>
          </>
        ) : rec.mode === "studio" ? (
          <>
            <span aria-hidden>·</span>
            <span className="inline-flex items-center gap-1">
              <MicOff className="size-3.5" aria-hidden />
              No mic
            </span>
          </>
        ) : null}
      </div>

      <p className="mt-2 truncate font-mono text-xs text-zinc-400" title={path}>
        {baseName(path)}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {rec.uploaded ? (
          <Badge tone="emerald">Uploaded</Badge>
        ) : (
          <Badge tone="amber">Not uploaded</Badge>
        )}
        {rec.transcribed ? <Badge tone="sky">Transcribed</Badge> : null}
        {rec.error ? <span className="break-words text-xs text-rose-400">{rec.error}</span> : null}
      </div>

      {job ? <JobProgress job={job} /> : null}

      <div className="mt-3 flex flex-wrap gap-2">
        {hasEditor ? (
          <LinkButton
            to={editorHref}
            disabled={busy}
            icon={<Scissors className="size-3.5" aria-hidden />}
          >
            Open in editor
          </LinkButton>
        ) : null}
        {canUpload ? (
          <Button
            size="sm"
            variant="primary"
            icon={<Upload className="size-3.5" aria-hidden />}
            disabled={busy}
            loading={uploadDemo.isPending}
            onClick={() => uploadDemo.mutate()}
          >
            Upload
          </Button>
        ) : null}
        {canProcess ? (
          <Button
            size="sm"
            variant="primary"
            icon={<Play className="size-3.5" aria-hidden />}
            disabled={busy}
            loading={processRecording.isPending}
            onClick={() => processRecording.mutate()}
          >
            {rec.transcribed || rec.exportPath || rec.error ? "Resume processing" : "Process"}
          </Button>
        ) : null}
        {rec.postId ? (
          <LinkButton
            to={`/drafts/${rec.postId}`}
            variant="ghost"
            icon={<SquarePen className="size-3.5" aria-hidden />}
          >
            Open draft
          </LinkButton>
        ) : null}
        {rec.sessionId ? (
          <LinkButton
            to={`/sessions/${rec.sessionId}`}
            variant="ghost"
            icon={<ListChecks className="size-3.5" aria-hidden />}
          >
            Session
          </LinkButton>
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          icon={<FolderOpen className="size-3.5" aria-hidden />}
          onClick={() => void reveal()}
        >
          Show in {FILE_MANAGER}
        </Button>
        <Button
          size="sm"
          variant="danger"
          icon={<Trash2 className="size-3.5" aria-hidden />}
          disabled={busy}
          loading={deleteRecording.isPending}
          onClick={() => void confirmDelete()}
        >
          Delete
        </Button>
      </div>
    </article>
  );
}

/** Live progress of the pipeline job attached to a recording. */
function JobProgress({ job }: { job: Job }) {
  const percent = job.percent === null ? null : Math.min(100, Math.max(0, job.percent));
  return (
    <div className="mt-3 rounded-lg border border-sky-500/20 bg-sky-500/5 p-3 text-xs">
      <div className="flex items-center gap-2">
        <LoaderCircle className="size-3.5 shrink-0 animate-spin text-sky-400" aria-hidden />
        <span className="shrink-0 font-medium text-zinc-200">{job.label}</span>
        <span className="truncate text-zinc-500">{job.detail ?? STAGE_LABEL[job.stage]}</span>
        {percent !== null ? (
          <span className="ml-auto shrink-0 tabular-nums text-zinc-400">{percent}%</span>
        ) : null}
      </div>
      {percent !== null ? (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
          <div
            className="h-full rounded-full bg-sky-500 transition-[width]"
            style={{ width: `${percent}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}

/** Small button that navigates; rendered without the link while disabled. */
function LinkButton({ to, disabled, ...rest }: ButtonProps & { to: string }) {
  const button = <Button size="sm" disabled={disabled} {...rest} />;
  return disabled ? button : <Link to={to}>{button}</Link>;
}
