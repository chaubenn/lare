import { Progress } from "@lare/ui/primitives";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Camera, Mic, Monitor, Scissors, Trash2, Video } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Link } from "react-router";
import { useToast } from "@/components/toast/ToastProvider";
import { Button } from "@/components/ui/Button";
import { Card, SectionTitle } from "@/components/ui/Card";
import { Toggle } from "@/components/ui/Field";
import { VideoEmbed } from "@/components/VideoEmbed";
import { useUser } from "@/features/auth/AuthProvider";
import { usePermissions, useRecorderStatus, useVideo } from "@/features/recording/hooks";
import { isActive, useJobs } from "@/features/recording/jobs";
import type { VideoSlot } from "@/features/recording/pipeline";
import { patchRecordingMeta } from "@/features/recording/recordingStore";
import { recorder } from "@/lib/recorder";
import { errorMessage, invokeFunction } from "@/lib/supabase";
import { inTauri } from "@/lib/tauri";
import type { Draft } from "./queries";
import { draftKey, draftsKey } from "./queries";

/** Everything the two panels share: recorder state, permissions and cache invalidation. */
function useSlotRecording(draft: Draft) {
  const { userId } = useUser();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const status = useRecorderStatus();
  const permissions = usePermissions();

  const recordingBusy = status.state !== "idle" && status.state !== "error";
  const screenOk =
    permissions.data?.screenRecording === "granted" ||
    permissions.data?.screenRecording === "not_applicable";

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: draftKey(draft.id) }),
      queryClient.invalidateQueries({ queryKey: draftsKey(userId) }),
    ]);
  };

  /**
   * Start a take for one slot. The recorder only knows which post it belongs to, so the slot is
   * written to the local recording store here and read back when the take finishes (instant) or
   * is published from the studio editor.
   */
  const start = async (
    mode: "instant" | "studio",
    slot: VideoSlot,
    options: { facecam: boolean; mic: boolean },
  ) => {
    const state = await recorder.start({ mode, postId: draft.id, ...options });
    if (state.recordingId) await patchRecordingMeta(state.recordingId, { slot });
    toast({
      title: mode === "instant" ? "Recording — one take" : "Recording — studio",
      description:
        mode === "instant"
          ? "Stop from the pill to upload straight away."
          : "Stop from the pill, then trim and publish from the editor.",
    });
  };

  return { permissions, recordingBusy, screenOk, invalidate, start, toast };
}

/**
 * The video half of a draft. A practice post has one slot — the demo walkthrough. A mock
 * interview has two: the full recording (processed automatically when the session ends) and
 * an optional summary the author records afterwards, which plays before the full take.
 */
export function DemoVideoPanel({ draft }: { draft: Draft }) {
  const isInterview = draft.sessions?.kind === "interview";
  return (
    <>
      <MainVideoPanel draft={draft} />
      {isInterview ? <SummaryVideoPanel draft={draft} /> : null}
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

  const recordingId = draft.sessions?.recording_id ?? null;

  const removeVideo = useMutation({
    mutationFn: async () => {
      if (!draft.video_id) return;
      await invokeFunction("video-delete", { videoId: draft.video_id });
    },
    onSuccess: async () => {
      await slot.invalidate();
      slot.toast({ title: "Video removed" });
    },
    onError: (e) =>
      slot.toast({
        title: "Couldn't remove video",
        description: errorMessage(e),
        variant: "error",
      }),
  });

  return (
    <Card>
      <SectionTitle>{isInterview ? "Interview video" : "Demo video"}</SectionTitle>

      {draft.video_id && video.data ? (
        <div className="space-y-3">
          <VideoEmbed video={video.data} title={draft.title ?? "Demo video"} />
          <p className="text-xs text-zinc-500">
            {draft.video_kind === "highlights" ? "Highlights reel" : "Full recording"}
            {video.data.duration_ms ? ` · ${Math.round(video.data.duration_ms / 1000)}s` : ""}
          </p>
          <div className="flex flex-wrap gap-2">
            {recordingId ? (
              <Link to={`/studio/${recordingId}?post=${draft.id}`}>
                <Button size="sm" icon={<Scissors className="size-3.5" aria-hidden />}>
                  {isInterview ? "Cut highlights" : "Re-edit"}
                </Button>
              </Link>
            ) : null}
            <Button
              size="sm"
              variant="danger"
              icon={<Trash2 className="size-3.5" aria-hidden />}
              loading={removeVideo.isPending}
              onClick={() => removeVideo.mutate()}
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
            The interview recording is processed automatically when the session ends. If it did not
            finish, resume it from{" "}
            <Link to="/recordings" className="text-emerald-400 hover:underline">
              Recordings
            </Link>
            .
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
 * went, what they would do differently. It sits between the session breakdown and the full take
 * in the post's carousel, so viewers get the overview before the forty-minute recording.
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
      await invokeFunction("video-delete", { videoId: draft.demo_video_id });
    },
    onSuccess: async () => {
      await slot.invalidate();
      slot.toast({ title: "Summary video removed" });
    },
    onError: (e) =>
      slot.toast({
        title: "Couldn't remove the summary video",
        description: errorMessage(e),
        variant: "error",
      }),
  });

  return (
    <Card>
      <SectionTitle>Summary video</SectionTitle>

      {draft.demo_video_id && video.data ? (
        <div className="space-y-3">
          <VideoEmbed video={video.data} title="Summary video" />
          <p className="text-xs text-zinc-500">
            Plays before the full recording
            {video.data.duration_ms ? ` · ${Math.round(video.data.duration_ms / 1000)}s` : ""}
          </p>
          <Button
            size="sm"
            variant="danger"
            icon={<Trash2 className="size-3.5" aria-hidden />}
            loading={removeVideo.isPending}
            onClick={() => removeVideo.mutate()}
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
      <p className="text-xs text-zinc-500">{detail ?? "Working…"}</p>
      {percent !== null ? <Progress value={percent} label={label} /> : null}
    </div>
  );
}

/** Mic/facecam switches and the two record buttons, for whichever slot is being filled. */
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
  const { permissions, recordingBusy, screenOk, start, toast } = recording;
  const [facecam, setFacecam] = useState(false);
  const [mic, setMic] = useState(true);
  const [starting, setStarting] = useState(false);

  const blocked = !inTauri || recordingBusy || starting || (permissions.data ? !screenOk : false);

  const run = async (mode: "instant" | "studio") => {
    setStarting(true);
    try {
      await start(mode, slot, { facecam, mic });
    } catch (e) {
      toast({ title: "Couldn't start recording", description: errorMessage(e), variant: "error" });
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
          <Link to="/settings" className="underline">
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
          description="Instant: the preview bubble is captured on screen. Studio: recorded as its own track."
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          icon={<Video className="size-4" aria-hidden />}
          disabled={blocked}
          loading={starting}
          onClick={() => void run("instant")}
          title="One take: stops, uploads and attaches immediately"
        >
          Record (Instant)
        </Button>
        <Button
          icon={<Monitor className="size-4" aria-hidden />}
          disabled={blocked}
          onClick={() => void run("studio")}
          title="Record, then trim and cut before publishing"
        >
          Record (Studio)
        </Button>
      </div>
      {recordingBusy ? (
        <p className="text-xs text-zinc-500">
          A recording is in progress — stop it from the pill first.
        </p>
      ) : null}
      <p className="text-xs text-zinc-500">
        Instant publishes as soon as you stop. Studio opens an editor to trim and cut first.
      </p>
    </div>
  );
}
