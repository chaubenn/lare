import { Camera, Mic, Trash2, Video } from "@lare/ui/icons";
import { Button, Card, Progress, SectionTitle, Toggle } from "@lare/ui/primitives";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { Link } from "react-router";
import { confirm } from "@/components/ui/Confirm";
import { useUser } from "@/features/auth/AuthProvider";
import { usePermissions, useRecorderStatus, useRecordings, useVideo } from "@/features/media/hooks";
import { isActive, useJobs } from "@/features/media/jobs";
import { publishInstantDemo, startSlotRecording } from "@/features/media/pipeline";
import type { VideoSlot } from "@/features/media/types";
import { VideoEmbed } from "@/features/media/VideoEmbed";
import { edge } from "@/lib/edge";
import { notify, notifyError } from "@/lib/notices";
import { queryKeys } from "@/lib/queryKeys";
import { routes } from "@/lib/routes";
import { inTauri } from "@/lib/tauri";
import type { Draft } from "./queries";

/** Everything the two panels share: recorder state, permissions and cache invalidation. */
function useSlotRecording(draft: Draft) {
  const { userId } = useUser();
  const queryClient = useQueryClient();
  const status = useRecorderStatus();
  const permissions = usePermissions();

  const recordingBusy = status.state !== "idle" && status.state !== "error";
  const screenOk =
    permissions.data?.screenRecording === "granted" ||
    permissions.data?.screenRecording === "not_applicable";

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.draft.of(draft.id) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.drafts.of(userId) }),
    ]);
  };

  const start = async (slot: VideoSlot, options: { facecam: boolean; mic: boolean }) => {
    await startSlotRecording({ postId: draft.id, slot, ...options });
    notify({
      title: "Recording",
      description: "Stop from the pill to upload straight away.",
    });
  };

  return { permissions, recordingBusy, screenOk, invalidate, start };
}

/**
 * The video half of a draft. A practice post has one slot — the demo walkthrough. A mock
 * interview has two: the full recording (processed automatically when the session ends) and
 * an optional summary the author records afterwards, which plays before the full take.
 */
export function DemoVideoPanel({ draft }: { draft: Draft }) {
  const isInterview = draft.sessions?.kind === "interview";
  const recordings = useRecordings();
  const { userId } = useUser();
  const queryClient = useQueryClient();
  const working = useJobs().some((job) => isActive(job) && job.postId === draft.id);
  const retry = useMutation({
    mutationFn: (recording: NonNullable<typeof recordings.data>[number]) =>
      publishInstantDemo({
        recording,
        userId,
        postId: draft.id,
        slot: recording.slot,
        title: draft.title ?? "Demo video",
        queryClient,
      }),
    onError: (error) => notifyError("Upload failed; source kept", error),
  });
  const pending = recordings.data?.filter((r) => r.postId === draft.id && !r.uploaded) ?? [];
  return (
    <>
      <MainVideoPanel draft={draft} />
      {isInterview ? <SummaryVideoPanel draft={draft} /> : null}
      {pending.length > 0 && (
        <Card>
          <SectionTitle>Unfinished takes on this device</SectionTitle>
          <div className="space-y-3">
            {pending.map((recording) => (
              <div key={recording.recordingId} className="space-y-1 text-sm">
                <p>
                  {recording.slot === "demo" ? "Summary" : "Demo"} -{" "}
                  {new Date(recording.startedAt).toLocaleString()}
                </p>
                {recording.error && <p className="text-xs text-rose-400">{recording.error}</p>}
                <Button
                  size="sm"
                  disabled={retry.isPending || working}
                  onClick={() => retry.mutate(recording)}
                >
                  Retry upload
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}

/** `video_id`: the demo walkthrough of a practice post, or the full take of an interview. */
function MainVideoPanel({ draft }: { draft: Draft }) {
  const slot = useSlotRecording(draft);
  const video = useVideo(draft.video_id);
  const isInterview = draft.sessions?.kind === "interview";
  // On an interview the only job that fills this slot is the interview pipeline itself; a
  // publish/export job on the same post is the summary clip, and belongs to the panel below.
  const activeJob = useJobs().find(
    (j) =>
      isActive(j) &&
      (j.postId === draft.id || (j.sessionId && j.sessionId === draft.session_id)) &&
      (!isInterview || j.kind === "interview"),
  );

  const removeVideo = useMutation({
    mutationFn: async () => {
      if (!draft.video_id) return;
      await edge.deleteVideo(draft.video_id);
    },
    onSuccess: async () => {
      await slot.invalidate();
      notify({ title: "Video removed" });
    },
    onError: (e) => notifyError("Couldn't remove video", e),
  });
  // The interview take is recorded live during the session: once it is gone there is no second
  // attempt, unlike a demo you can simply record again.
  const confirmRemove = async () => {
    const ok = await confirm(
      isInterview
        ? {
            title: "Remove interview video",
            message:
              "Remove the recording of this interview from the draft? It can't be recorded again, so the post will have no interview video.",
            confirmLabel: "Remove",
            destructive: true,
          }
        : {
            title: "Remove demo video",
            message: "Remove this demo video from the draft? You can record a new one afterwards.",
            confirmLabel: "Remove",
            destructive: true,
          },
    );
    if (ok) removeVideo.mutate();
  };

  return (
    <Card>
      <SectionTitle>{isInterview ? "Interview video" : "Demo video"}</SectionTitle>

      {draft.video_id && video.data ? (
        <div className="space-y-3">
          <VideoEmbed video={video.data} title={draft.title ?? "Demo video"} />
          <p className="text-xs text-[var(--text-tertiary)]">
            {draft.video_kind === "highlights" ? "Highlights reel" : "Full recording"}
            {video.data.duration_ms ? ` · ${Math.round(video.data.duration_ms / 1000)}s` : ""}
          </p>
          {activeJob ? (
            <JobProgress
              label={activeJob.label}
              detail={activeJob.detail}
              percent={activeJob.percent}
            />
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="danger"
              icon={<Trash2 className="size-3.5" aria-hidden />}
              loading={removeVideo.isPending}
              // Deleting a video mid-upload would pull it out from under its own pipeline.
              disabled={!!activeJob}
              onClick={() => void confirmRemove()}
            >
              Remove
            </Button>
          </div>
        </div>
      ) : activeJob ? (
        <JobProgress
          label={activeJob.label}
          detail={activeJob.detail}
          percent={activeJob.percent}
        />
      ) : isInterview ? (
        <div className="space-y-2 text-sm text-zinc-400">
          <p>
            The desktop app records the interview and uploads it when you end it from the extension.
          </p>
        </div>
      ) : (
        <RecordControls
          slot="main"
          idPrefix="demo"
          blurb="Record a quick walkthrough of your solution and attach it to the post."
          recording={slot}
        />
      )}
    </Card>
  );
}

/**
 * `demo_video_id`: the short clip an interview author records about the session itself — how it
 * went, what they would do differently. It sits ahead of the full take in the post's carousel,
 * so viewers get the overview before the forty-minute recording.
 */
function SummaryVideoPanel({ draft }: { draft: Draft }) {
  const slot = useSlotRecording(draft);
  const video = useVideo(draft.demo_video_id);
  // Everything but the interview pipeline: on an interview draft that is the summary upload.
  const activeJob = useJobs().find(
    (j) => isActive(j) && j.postId === draft.id && j.kind !== "interview",
  );

  const removeVideo = useMutation({
    mutationFn: async () => {
      if (!draft.demo_video_id) return;
      await edge.deleteVideo(draft.demo_video_id);
    },
    onSuccess: async () => {
      await slot.invalidate();
      notify({ title: "Summary video removed" });
    },
    onError: (e) => notifyError("Couldn't remove the summary video", e),
  });
  const confirmRemove = async () => {
    const ok = await confirm({
      title: "Remove summary video",
      message: "Remove the summary video from this draft? You can record a new one afterwards.",
      confirmLabel: "Remove",
      destructive: true,
    });
    if (ok) removeVideo.mutate();
  };

  return (
    <Card>
      <SectionTitle>Summary video</SectionTitle>

      {draft.demo_video_id && video.data ? (
        <div className="space-y-3">
          <VideoEmbed video={video.data} title="Summary video" />
          <p className="text-xs text-[var(--text-tertiary)]">
            Plays before the full recording
            {video.data.duration_ms ? ` · ${Math.round(video.data.duration_ms / 1000)}s` : ""}
          </p>
          {activeJob ? (
            <JobProgress
              label={activeJob.label}
              detail={activeJob.detail}
              percent={activeJob.percent}
            />
          ) : null}
          <Button
            size="sm"
            variant="danger"
            icon={<Trash2 className="size-3.5" aria-hidden />}
            loading={removeVideo.isPending}
            disabled={!!activeJob}
            onClick={() => void confirmRemove()}
          >
            Remove
          </Button>
        </div>
      ) : activeJob ? (
        <JobProgress
          label={activeJob.label}
          detail={activeJob.detail}
          percent={activeJob.percent}
        />
      ) : (
        <RecordControls
          slot="demo"
          idPrefix="summary"
          blurb="Record a short debrief — how the interview went, what you'd change — to open the post with."
          recording={slot}
        />
      )}
    </Card>
  );
}

function JobProgress({
  label,
  detail,
  percent,
}: {
  label: string;
  detail: string | null;
  percent: number | null;
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm text-zinc-300">{label}</p>
      <p className="text-xs text-[var(--text-tertiary)]">{detail ?? "Working…"}</p>
      {percent !== null ? <Progress value={percent} label={label} /> : null}
    </div>
  );
}

/** Mic/facecam switches and the record button, for whichever slot is being filled. */
function RecordControls({
  slot,
  idPrefix,
  blurb,
  recording,
}: {
  slot: VideoSlot;
  /** Prefix for the toggle ids, so both panels can be on the page at once. */
  idPrefix: string;
  blurb: ReactNode;
  recording: ReturnType<typeof useSlotRecording>;
}) {
  const { permissions, recordingBusy, screenOk, start } = recording;
  const [facecam, setFacecam] = useState(false);
  const [mic, setMic] = useState(true);
  const [starting, setStarting] = useState(false);

  const blocked = !inTauri || recordingBusy || starting || (permissions.data ? !screenOk : false);

  const run = async () => {
    setStarting(true);
    try {
      await start(slot, { facecam, mic });
    } catch (e) {
      notifyError("Couldn't start recording", e);
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-zinc-400">{blurb}</p>
      {!inTauri ? (
        <p className="text-xs text-amber-400">Recording is only available in the desktop app.</p>
      ) : permissions.data && !screenOk ? (
        <p className="text-xs text-amber-400">
          Screen recording permission is required.{" "}
          <Link to={routes.settings} className="underline">
            Grant it in Settings
          </Link>
          .
        </p>
      ) : null}
      <div className="grid gap-2">
        <Toggle
          id={`${idPrefix}-mic`}
          checked={mic}
          onChange={setMic}
          label={
            <span className="inline-flex items-center gap-1.5">
              <Mic className="size-3.5" aria-hidden /> Microphone
            </span>
          }
        />
        <Toggle
          id={`${idPrefix}-facecam`}
          checked={facecam}
          onChange={setFacecam}
          label={
            <span className="inline-flex items-center gap-1.5">
              <Camera className="size-3.5" aria-hidden /> Facecam
            </span>
          }
          description="The preview bubble is captured on screen."
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          icon={<Video className="size-4" aria-hidden />}
          disabled={blocked}
          loading={starting}
          onClick={() => void run()}
          title="Stops, uploads and attaches immediately"
        >
          Record
        </Button>
      </div>
      {recordingBusy ? (
        <p className="text-xs text-[var(--text-tertiary)]">
          A recording is in progress — stop it from the pill first.
        </p>
      ) : null}
    </div>
  );
}
