/**
 * Studio editor (`/studio/:recordingId?post=…`): trim/cut a studio recording, place the facecam,
 * pick a background, then render with Cap's exporter and upload to Bunny.
 *
 * The preview plays the raw display track (asset protocol); the edit is applied at render time.
 */

import { formatDurationHuman } from "@lare/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { convertFileSrc } from "@tauri-apps/api/core";
import { ArrowLeft, Film, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useToast } from "@/components/toast/ToastProvider";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, PageHeader } from "@/components/ui/Card";
import { EmptyState, ErrorState, PageSpinner } from "@/components/ui/States";
import { useUser } from "@/features/auth/AuthProvider";
import { useInterviewReview } from "@/features/posts/queries";
import { createJob, isActive, updateJob, useJobs } from "@/features/recording/jobs";
import {
  exportAndPublish,
  postForSession,
  renderStudio,
  type VideoSlot,
} from "@/features/recording/pipeline";
import { getRecordingMeta } from "@/features/recording/recordingStore";
import {
  type CompletedRecording,
  DEFAULT_EDIT,
  newJobId,
  recorder,
  type StudioEdit,
  type StudioProjectInfo,
  type TimeRange,
} from "@/lib/recorder";
import { errorMessage, supabase } from "@/lib/supabase";
import { inTauri } from "@/lib/tauri";
import { StudioClips } from "./Clips";
import { StudioControls, StudioToolbar } from "./Controls";
import { StudioPreview } from "./Preview";
import { StudioProjectCard, StudioPublishCard, StudioRenderPanel } from "./RenderPanel";
import { highlightRanges, mergeRanges } from "./ranges";
import { StudioTimeline } from "./Timeline";

export { highlightRanges, mergeRanges } from "./ranges";

function useRecording(recordingId: string) {
  return useQuery({
    queryKey: ["recorder", "recording", recordingId],
    enabled: inTauri,
    queryFn: async (): Promise<{
      recording: CompletedRecording;
      info: StudioProjectInfo;
      slot: VideoSlot;
    } | null> => {
      const list = await recorder.list();
      const recording = list.find((r) => r.recordingId === recordingId);
      if (!recording) return null;
      const [info, meta] = await Promise.all([
        recorder.studioProjectInfo(recording.projectPath),
        getRecordingMeta(recording.recordingId),
      ]);
      return { recording, info, slot: meta?.slot ?? ("main" as VideoSlot) };
    },
  });
}

function useAttachTarget(recording: CompletedRecording | undefined, postParam: string | null) {
  return useQuery({
    queryKey: ["studio", "attach-target", recording?.recordingId, postParam],
    enabled: !!recording,
    queryFn: async (): Promise<{ postId: string; title: string | null; status: string } | null> => {
      const id = postParam ?? recording?.postId ?? null;
      if (id) {
        const { data } = await supabase
          .from("posts")
          .select("id, title, status")
          .eq("id", id)
          .maybeSingle();
        if (data) return { postId: data.id, title: data.title, status: data.status };
      }
      if (recording?.sessionId) {
        const post = await postForSession(recording.sessionId);
        if (post) {
          const { data } = await supabase
            .from("posts")
            .select("id, title, status")
            .eq("id", post.id)
            .maybeSingle();
          if (data) return { postId: data.id, title: data.title, status: data.status };
        }
      }
      return null;
    },
  });
}

export function StudioEditorPage() {
  const { recordingId = "" } = useParams();
  const [search] = useSearchParams();
  const loaded = useRecording(recordingId);

  if (!inTauri) {
    return <EmptyState title="Studio is only available in the desktop app" />;
  }
  if (loaded.isPending) return <PageSpinner label="Opening project…" />;
  if (loaded.isError)
    return <ErrorState error={loaded.error} onRetry={() => void loaded.refetch()} />;
  if (!loaded.data) {
    return (
      <EmptyState
        title="Recording not found"
        description="It may have been deleted from disk."
        action={
          <Link to="/recordings" className="text-sm text-emerald-400 hover:underline">
            Back to recordings
          </Link>
        }
      />
    );
  }
  return (
    <StudioEditor
      key={recordingId}
      recording={loaded.data.recording}
      info={loaded.data.info}
      slot={loaded.data.slot}
      postParam={search.get("post")}
    />
  );
}

function StudioEditor({
  recording,
  info,
  slot,
  postParam,
}: {
  recording: CompletedRecording;
  info: StudioProjectInfo;
  /** Which video slot of the attached post this take fills (chosen when recording started). */
  slot: VideoSlot;
  postParam: string | null;
}) {
  const { userId } = useUser();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const attach = useAttachTarget(recording, postParam);
  const review = useInterviewReview(recording.sessionId);
  const jobs = useJobs().filter((j) => j.recordingId === recording.recordingId);
  const activeJob = jobs.find(isActive);

  const duration = info.durationMs / 1000;
  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraRef = useRef<HTMLVideoElement>(null);
  const micRef = useRef<HTMLAudioElement>(null);
  const [current, setCurrent] = useState(0);
  const [markIn, setMarkIn] = useState<number | null>(null);
  const [edit, setEdit] = useState<StudioEdit>(() => ({
    ...DEFAULT_EDIT,
    camera: { ...DEFAULT_EDIT.camera, hide: !info.cameraPath },
  }));
  const [cameraFailed, setCameraFailed] = useState(false);
  const [micFailed, setMicFailed] = useState(false);
  const [title, setTitle] = useState(
    recording.purpose === "interview" ? "Mock interview" : "Demo video",
  );

  // A pause/resume during recording produces several clips; the preview plays them back to back
  // by switching the <video> source when the playhead crosses a clip boundary.
  const clips =
    info.clips.length > 0 || !info.displayPath
      ? info.clips
      : [{ displayPath: info.displayPath, durationMs: info.durationMs, offsetMs: 0 }];
  const clipAt = (seconds: number) => {
    const ms = seconds * 1000;
    let found = clips[0];
    for (const c of clips) if (ms >= c.offsetMs) found = c;
    return found;
  };
  const [clipIndex, setClipIndex] = useState(0);
  const activeClip = clips[clipIndex] ?? clips[0];
  const pendingSeek = useRef<number | null>(null);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => {
      const clip = clips[clipIndex];
      if (clip) setCurrent(clip.offsetMs / 1000 + v.currentTime);
      for (const other of [cameraRef.current, micRef.current]) {
        if (!other) continue;
        if (Math.abs(other.currentTime - v.currentTime) > 0.3) other.currentTime = v.currentTime;
      }
    };
    const onPlay = () => {
      void cameraRef.current?.play().catch(() => setCameraFailed(true));
      void micRef.current?.play().catch(() => setMicFailed(true));
    };
    const onPause = () => {
      cameraRef.current?.pause();
      micRef.current?.pause();
    };
    const onEnded = () => {
      if (clipIndex + 1 < clips.length) {
        pendingSeek.current = 0;
        setClipIndex(clipIndex + 1);
        // Autoplay the next clip once its source is attached.
        window.setTimeout(() => void videoRef.current?.play().catch(() => undefined), 50);
      }
    };
    const onLoaded = () => {
      if (pendingSeek.current !== null) {
        v.currentTime = pendingSeek.current;
        pendingSeek.current = null;
      }
    };
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("ended", onEnded);
    v.addEventListener("loadedmetadata", onLoaded);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    return () => {
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("ended", onEnded);
      v.removeEventListener("loadedmetadata", onLoaded);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
    };
  }, [clips, clipIndex]);

  const seek = (t: number) => {
    const clamped = Math.max(0, Math.min(duration, t));
    const clip = clipAt(clamped);
    const index = clip ? clips.indexOf(clip) : 0;
    const local = clip ? clamped - clip.offsetMs / 1000 : clamped;
    const v = videoRef.current;
    if (index !== clipIndex) {
      pendingSeek.current = local;
      setClipIndex(index);
    } else if (v) {
      v.currentTime = local;
      if (cameraRef.current) cameraRef.current.currentTime = local;
      if (micRef.current) micRef.current.currentTime = local;
    }
    setCurrent(clamped);
  };

  const outputDuration = useMemo(
    () =>
      edit.segments.length === 0
        ? duration
        : edit.segments.reduce((sum, r) => sum + (r.end - r.start), 0),
    [edit.segments, duration],
  );
  const isHighlights = edit.segments.length > 0 && outputDuration < duration - 0.5;

  const setSegments = (segments: TimeRange[]) =>
    setEdit((e) => ({ ...e, segments: mergeRanges(segments, duration) }));

  const addRange = () => {
    if (markIn === null) {
      setMarkIn(current);
      return;
    }
    const range = { start: Math.min(markIn, current), end: Math.max(markIn, current) };
    if (range.end - range.start < 0.5) {
      toast({ title: "Range too short", description: "Move the playhead at least half a second." });
      return;
    }
    setSegments([...edit.segments, range]);
    setMarkIn(null);
  };

  const trimStart = () => {
    const base = edit.segments.length ? edit.segments : [{ start: 0, end: duration }];
    setSegments(
      base.map((r, i) => (i === 0 ? { ...r, start: Math.min(current, r.end - 0.5) } : r)),
    );
  };
  const trimEnd = () => {
    const base = edit.segments.length ? edit.segments : [{ start: 0, end: duration }];
    const last = base.length - 1;
    setSegments(
      base.map((r, i) => (i === last ? { ...r, end: Math.max(current, r.start + 0.5) } : r)),
    );
  };
  const cutHere = () => {
    const base = edit.segments.length ? edit.segments : [{ start: 0, end: duration }];
    const next: TimeRange[] = [];
    for (const r of base) {
      if (current > r.start + 0.25 && current < r.end - 0.25) {
        next.push({ start: r.start, end: current }, { start: current, end: r.end });
      } else next.push(r);
    }
    setEdit((e) => ({ ...e, segments: next }));
  };
  const removeRange = (index: number) =>
    setEdit((e) => ({ ...e, segments: e.segments.filter((_, i) => i !== index) }));

  const useHighlights = () => {
    if (!review.data) return;
    const ranges = highlightRanges(review.data, duration);
    if (ranges.length === 0) {
      toast({
        title: "No highlight moments",
        description: "The AI review has no timestamped moments.",
      });
      return;
    }
    setSegments(ranges);
    toast({
      title: `${ranges.length} highlight ${ranges.length === 1 ? "range" : "ranges"} selected`,
    });
  };

  const run = async (publish: boolean) => {
    try {
      if (publish) {
        const videoId = await exportAndPublish({
          recording,
          edit,
          userId,
          postId: attach.data?.postId ?? null,
          slot,
          title,
          videoKind: isHighlights ? "highlights" : "full",
          queryClient,
        });
        toast({
          title: "Video uploaded",
          description: "Bunny is processing it now.",
          variant: "success",
        });
        if (attach.data?.postId) {
          void navigate(
            attach.data.status === "draft"
              ? `/drafts/${attach.data.postId}`
              : `/posts/${attach.data.postId}`,
          );
        } else {
          toast({
            title: "Not attached to a post",
            description: `Video ${videoId} is in your library.`,
          });
        }
      } else {
        const job = createJob(newJobId("export"), "export", "Rendering", {
          recordingId: recording.recordingId,
        });
        try {
          const output = await renderStudio({
            job,
            projectPath: recording.projectPath,
            edit,
            recordingId: recording.recordingId,
          });
          updateJob(job.id, { stage: "done", detail: output });
          toast({ title: "Rendered", description: output, variant: "success" });
        } catch (e) {
          updateJob(job.id, { stage: "error", error: errorMessage(e), detail: errorMessage(e) });
          throw e;
        }
      }
      await queryClient.invalidateQueries({ queryKey: ["recorder", "recordings"] });
    } catch (e) {
      toast({
        title: publish ? "Publish failed" : "Render failed",
        description: errorMessage(e),
        variant: "error",
      });
    }
  };

  const previewSrc = activeClip ? convertFileSrc(activeClip.displayPath) : null;
  const cameraSrc = info.cameraPath ? convertFileSrc(info.cameraPath) : null;
  const micSrc = info.micPath ? convertFileSrc(info.micPath) : null;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <Link
          to="/recordings"
          className="inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-zinc-200"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Recordings
        </Link>
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <Badge>{recording.purpose === "interview" ? "Mock interview" : "Demo"}</Badge>
          <span>{formatDurationHuman(info.durationMs)}</span>
          {info.width && info.height ? (
            <span>
              {info.width}×{info.height}
            </span>
          ) : null}
        </div>
      </div>

      <PageHeader
        title="Studio"
        subtitle="Trim and cut, place your facecam, then render and publish."
        actions={
          <>
            <Button
              icon={<Film className="size-4" aria-hidden />}
              disabled={!!activeJob}
              onClick={() => void run(false)}
              title="Render to an MP4 on disk without uploading"
            >
              Render only
            </Button>
            <Button
              variant="primary"
              icon={<Upload className="size-4" aria-hidden />}
              disabled={!!activeJob}
              onClick={() => void run(true)}
            >
              Render & publish
            </Button>
          </>
        }
      />

      {activeJob ? <StudioRenderPanel job={activeJob} /> : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-4">
          <Card className="space-y-3">
            <StudioPreview
              previewSrc={previewSrc}
              cameraSrc={cameraSrc}
              micSrc={micSrc}
              activeClip={activeClip}
              clips={clips}
              clipIndex={clipIndex}
              videoRef={videoRef}
              cameraRef={cameraRef}
              micRef={micRef}
              edit={edit}
              info={info}
              onCameraError={() => setCameraFailed(true)}
              onMicError={() => setMicFailed(true)}
            />
            <StudioTimeline
              duration={duration}
              current={current}
              segments={edit.segments}
              markIn={markIn}
              onSeek={seek}
            />
            <StudioToolbar
              current={current}
              duration={duration}
              markIn={markIn}
              hasReview={!!review.data}
              hasSegments={edit.segments.length > 0}
              onTrimStart={trimStart}
              onTrimEnd={trimEnd}
              onCut={cutHere}
              onAddRange={addRange}
              onHighlights={useHighlights}
              onKeepEverything={() => setEdit((e) => ({ ...e, segments: [] }))}
            />
          </Card>

          <StudioClips
            segments={edit.segments}
            duration={duration}
            outputDuration={outputDuration}
            isHighlights={isHighlights}
            onSeek={seek}
            onRemove={removeRange}
          />
        </div>

        <aside className="space-y-4">
          <StudioPublishCard title={title} onTitleChange={setTitle} attach={attach.data} />
          <StudioControls
            edit={edit}
            setEdit={setEdit}
            info={info}
            cameraFailed={cameraFailed}
            micFailed={micFailed}
          />
          <StudioProjectCard info={info} />
        </aside>
      </div>
    </div>
  );
}
