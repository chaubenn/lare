import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Camera, Mic, Monitor, Scissors, Trash2, Video } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { useToast } from "@/components/toast/ToastProvider";
import { Button } from "@/components/ui/Button";
import { Card, SectionTitle } from "@/components/ui/Card";
import { Toggle } from "@/components/ui/Field";
import { VideoEmbed } from "@/components/VideoEmbed";
import { useUser } from "@/features/auth/AuthProvider";
import { usePermissions, useRecorderStatus, useVideo } from "@/features/recording/hooks";
import { isActive, useJobs } from "@/features/recording/jobs";
import { recorder } from "@/lib/recorder";
import { errorMessage, invokeFunction, supabase } from "@/lib/supabase";
import { inTauri } from "@/lib/tauri";
import type { Draft } from "./queries";
import { draftKey, draftsKey } from "./queries";

/**
 * Demo video controls for a draft: record (instant or studio), watch the upload/processing state,
 * remove or re-cut the attached video, and choose whether AI insights ship with the post.
 */
export function DemoVideoPanel({ draft }: { draft: Draft }) {
  const { userId } = useUser();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const status = useRecorderStatus();
  const permissions = usePermissions();
  const video = useVideo(draft.video_id);
  const jobs = useJobs().filter(
    (j) => j.postId === draft.id || (j.sessionId && j.sessionId === draft.session_id),
  );
  const activeJob = jobs.find(isActive);

  const [facecam, setFacecam] = useState(false);
  const [mic, setMic] = useState(true);
  const [starting, setStarting] = useState(false);

  const isInterview = draft.sessions?.kind === "interview";
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

  const start = async (mode: "instant" | "studio") => {
    setStarting(true);
    try {
      await recorder.start({ mode, postId: draft.id, facecam, mic });
      toast({
        title: mode === "instant" ? "Recording — one take" : "Recording — studio",
        description:
          mode === "instant"
            ? "Stop from the pill to upload straight away."
            : "Stop from the pill, then trim and publish from the editor.",
      });
    } catch (e) {
      toast({ title: "Couldn't start recording", description: errorMessage(e), variant: "error" });
    } finally {
      setStarting(false);
    }
  };

  const removeVideo = useMutation({
    mutationFn: async () => {
      if (!draft.video_id) return;
      await invokeFunction("video-delete", { videoId: draft.video_id });
    },
    onSuccess: async () => {
      await invalidate();
      toast({ title: "Video removed" });
    },
    onError: (e) =>
      toast({ title: "Couldn't remove video", description: errorMessage(e), variant: "error" }),
  });

  const setInsights = useMutation({
    mutationFn: async (include: boolean) => {
      const { error } = await supabase
        .from("posts")
        .update({ include_ai_insights: include })
        .eq("id", draft.id);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (e) =>
      toast({ title: "Couldn't update", description: errorMessage(e), variant: "error" }),
  });

  const recordingId = draft.sessions?.recording_id ?? null;

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
        <div className="space-y-2">
          <p className="text-sm text-zinc-300">{activeJob.label}</p>
          <p className="text-xs text-zinc-500">{activeJob.detail ?? "Working…"}</p>
          {activeJob.percent !== null ? (
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
              <div
                className="h-full rounded-full bg-sky-500 transition-[width]"
                style={{ width: `${activeJob.percent}%` }}
              />
            </div>
          ) : null}
        </div>
      ) : isInterview && !draft.video_id ? (
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
        <div className="space-y-3">
          <p className="text-sm text-zinc-400">
            Record a quick walkthrough of your solution and attach it to the post.
          </p>
          {!inTauri ? (
            <p className="text-xs text-amber-400">
              Recording is only available in the desktop app.
            </p>
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
              id="demo-mic"
              checked={mic}
              onChange={setMic}
              label={
                <span className="inline-flex items-center gap-1.5">
                  <Mic className="size-3.5" aria-hidden /> Microphone
                </span>
              }
            />
            <Toggle
              id="demo-facecam"
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
              disabled={
                !inTauri || recordingBusy || starting || (permissions.data ? !screenOk : false)
              }
              loading={starting}
              onClick={() => void start("instant")}
              title="One take: stops, uploads and attaches immediately"
            >
              Record (Instant)
            </Button>
            <Button
              icon={<Monitor className="size-4" aria-hidden />}
              disabled={
                !inTauri || recordingBusy || starting || (permissions.data ? !screenOk : false)
              }
              onClick={() => void start("studio")}
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
      )}

      {isInterview ? (
        <div className="mt-4 border-t border-zinc-800 pt-3">
          <Toggle
            id="demo-insights"
            checked={draft.include_ai_insights}
            onChange={(v) => setInsights.mutate(v)}
            label="Include AI insights with the post"
            description="Viewers of the post can see the interview grade, timestamped moments and suggestions."
          />
        </div>
      ) : null}
    </Card>
  );
}
