/**
 * Studio editor (`/studio/:recordingId?post=…`): trim/cut a studio recording, place the facecam,
 * pick a background, then render with Cap's exporter and upload to Bunny.
 *
 * The preview plays the raw display track (asset protocol); the edit is applied at render time.
 */

import { type AiReview, formatDurationHuman } from "@lare/shared";
import { cn } from "@lare/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  ArrowLeft,
  Camera,
  Clapperboard,
  Film,
  Plus,
  Scissors,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useToast } from "@/components/toast/ToastProvider";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, PageHeader, SectionTitle } from "@/components/ui/Card";
import { Input, Label, Select, Toggle } from "@/components/ui/Field";
import { EmptyState, ErrorState, PageSpinner } from "@/components/ui/States";
import { useUser } from "@/features/auth/AuthProvider";
import { useInterviewReview } from "@/features/posts/queries";
import { createJob, isActive, updateJob, useJobs } from "@/features/recording/jobs";
import { exportAndPublish, postForSession, renderStudio } from "@/features/recording/pipeline";
import {
  type CompletedRecording,
  type Corner,
  DEFAULT_EDIT,
  newJobId,
  recorder,
  type StudioEdit,
  type StudioProjectInfo,
  type TimeRange,
} from "@/lib/recorder";
import { errorMessage, supabase } from "@/lib/supabase";
import { inTauri } from "@/lib/tauri";

const CORNERS: { value: Corner; label: string }[] = [
  { value: "top-left", label: "Top left" },
  { value: "top-right", label: "Top right" },
  { value: "bottom-left", label: "Bottom left" },
  { value: "bottom-right", label: "Bottom right" },
];

function mmss(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0, 0, 0];
  const n = Number.parseInt(m[1] ?? "000000", 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** Merge overlapping/adjacent ranges and clamp to the duration. */
export function mergeRanges(ranges: TimeRange[], duration: number): TimeRange[] {
  const sorted = ranges
    .map((r) => ({
      start: Math.max(0, Math.min(r.start, r.end)),
      end: Math.min(duration, Math.max(r.start, r.end)),
    }))
    .filter((r) => r.end - r.start > 0.05)
    .sort((a, b) => a.start - b.start);
  const out: TimeRange[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end + 0.25) last.end = Math.max(last.end, r.end);
    else out.push({ ...r });
  }
  return out;
}

/** Highlight ranges around AI moments (10 s before, 20 s after), merged. */
export function highlightRanges(review: AiReview, duration: number): TimeRange[] {
  const ranges = review.moments
    .filter((m) => m.kind === "good" || m.kind === "issue")
    .map((m) => ({ start: m.t_ms / 1000 - 10, end: m.t_ms / 1000 + 20 }));
  return mergeRanges(ranges, duration);
}

function useRecording(recordingId: string) {
  return useQuery({
    queryKey: ["recorder", "recording", recordingId],
    enabled: inTauri,
    queryFn: async (): Promise<{
      recording: CompletedRecording;
      info: StudioProjectInfo;
    } | null> => {
      const list = await recorder.list();
      const recording = list.find((r) => r.recordingId === recordingId);
      if (!recording) return null;
      const info = await recorder.studioProjectInfo(recording.projectPath);
      return { recording, info };
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
      postParam={search.get("post")}
    />
  );
}

function StudioEditor({
  recording,
  info,
  postParam,
}: {
  recording: CompletedRecording;
  info: StudioProjectInfo;
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
  const [current, setCurrent] = useState(0);
  const [markIn, setMarkIn] = useState<number | null>(null);
  const [edit, setEdit] = useState<StudioEdit>(() => ({
    ...DEFAULT_EDIT,
    camera: { ...DEFAULT_EDIT.camera, hide: !info.cameraPath },
  }));
  const [title, setTitle] = useState(
    recording.purpose === "interview" ? "Mock interview" : "Demo video",
  );

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => setCurrent(v.currentTime);
    v.addEventListener("timeupdate", onTime);
    return () => v.removeEventListener("timeupdate", onTime);
  }, []);

  const seek = (t: number) => {
    const v = videoRef.current;
    const clamped = Math.max(0, Math.min(duration, t));
    if (v) v.currentTime = clamped;
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

  const previewSrc = info.displayPath ? convertFileSrc(info.displayPath) : null;

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

      {activeJob ? (
        <Card className="space-y-2">
          <p className="text-sm text-zinc-200">{activeJob.label}</p>
          <p className="text-xs text-zinc-500">{activeJob.detail ?? "Working…"}</p>
          {activeJob.percent !== null ? (
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
              <div
                className="h-full rounded-full bg-sky-500 transition-[width]"
                style={{ width: `${activeJob.percent}%` }}
              />
            </div>
          ) : null}
          <p className="text-xs text-zinc-500">
            Rendering runs at roughly real-time speed; uploading depends on your connection.
          </p>
        </Card>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-4">
          <Card className="space-y-3">
            {previewSrc ? (
              <div className="relative overflow-hidden rounded-lg bg-black">
                {/* biome-ignore lint/a11y/useMediaCaption: raw preview of the user's own recording */}
                <video ref={videoRef} src={previewSrc} controls className="aspect-video w-full" />
                {!edit.camera.hide && info.cameraPath ? (
                  <div
                    aria-hidden
                    className={cn(
                      "pointer-events-none absolute flex items-center justify-center border-2 border-emerald-400/80 bg-emerald-500/20 text-[10px] text-emerald-100",
                      edit.camera.keepAspect ? "aspect-video" : "aspect-square",
                      edit.camera.position.startsWith("top") ? "top-3" : "bottom-14",
                      edit.camera.position.endsWith("left") ? "left-3" : "right-3",
                    )}
                    style={{
                      width: `${Math.round(edit.camera.size * 0.6)}%`,
                      borderRadius: `${edit.camera.rounding / 2}%`,
                    }}
                  >
                    <Camera className="size-4" aria-hidden />
                  </div>
                ) : null}
              </div>
            ) : (
              <EmptyState
                title="No display track found"
                description="The project folder is missing display.mp4."
              />
            )}

            <Timeline
              duration={duration}
              current={current}
              segments={edit.segments}
              markIn={markIn}
              onSeek={seek}
            />

            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-zinc-400">
                {mmss(current)} / {mmss(duration)}
              </span>
              <span className="mx-1 text-zinc-700" aria-hidden>
                |
              </span>
              <Button size="sm" onClick={trimStart} title="Start the video at the playhead">
                Trim start
              </Button>
              <Button size="sm" onClick={trimEnd} title="End the video at the playhead">
                Trim end
              </Button>
              <Button
                size="sm"
                icon={<Scissors className="size-3.5" aria-hidden />}
                onClick={cutHere}
                title="Split the range at the playhead"
              >
                Split
              </Button>
              <Button
                size="sm"
                icon={<Plus className="size-3.5" aria-hidden />}
                onClick={addRange}
                title="Mark an in point, then an out point, to keep a range"
                className={cn(markIn !== null && "border-emerald-500/50 text-emerald-300")}
              >
                {markIn === null ? "Mark in" : `Mark out (${mmss(markIn)} →)`}
              </Button>
              {review.data ? (
                <Button
                  size="sm"
                  icon={<Sparkles className="size-3.5" aria-hidden />}
                  onClick={useHighlights}
                  title="Keep 30 s around each AI moment"
                >
                  AI highlights
                </Button>
              ) : null}
              {edit.segments.length > 0 ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setEdit((e) => ({ ...e, segments: [] }))}
                >
                  Keep everything
                </Button>
              ) : null}
            </div>
          </Card>

          <Card>
            <SectionTitle>Kept ranges</SectionTitle>
            {edit.segments.length === 0 ? (
              <p className="text-sm text-zinc-500">
                The whole recording ({mmss(duration)}) will be exported.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {edit.segments.map((r, i) => (
                  <li key={`${r.start}-${r.end}`} className="flex items-center gap-3 text-sm">
                    <button
                      type="button"
                      onClick={() => seek(r.start)}
                      className="font-mono text-zinc-200 hover:text-emerald-300"
                    >
                      {mmss(r.start)} → {mmss(r.end)}
                    </button>
                    <span className="text-xs text-zinc-500">{mmss(r.end - r.start)}</span>
                    <button
                      type="button"
                      onClick={() => removeRange(i)}
                      aria-label="Remove range"
                      className="ml-auto rounded p-1 text-zinc-500 hover:text-rose-300"
                    >
                      <Trash2 className="size-3.5" aria-hidden />
                    </button>
                  </li>
                ))}
                <li className="pt-1 text-xs text-zinc-500">
                  Output: {mmss(outputDuration)} {isHighlights ? "· published as highlights" : ""}
                </li>
              </ul>
            )}
          </Card>
        </div>

        <aside className="space-y-4">
          <Card className="space-y-3">
            <SectionTitle>Publish</SectionTitle>
            <div>
              <Label htmlFor="studio-title">Video title</Label>
              <Input
                id="studio-title"
                className="mt-1"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={120}
              />
            </div>
            <p className="text-xs text-zinc-500">
              {attach.data ? (
                <>
                  Attaches to{" "}
                  <Link
                    to={
                      attach.data.status === "draft"
                        ? `/drafts/${attach.data.postId}`
                        : `/posts/${attach.data.postId}`
                    }
                    className="text-emerald-400 hover:underline"
                  >
                    {attach.data.title ?? "your post"}
                  </Link>
                  .
                </>
              ) : (
                "Not linked to a post — the video will be in your library (Recordings)."
              )}
            </p>
          </Card>

          <Card className="space-y-3">
            <SectionTitle>Facecam</SectionTitle>
            {info.cameraPath ? (
              <>
                <Toggle
                  id="studio-cam-hide"
                  checked={!edit.camera.hide}
                  onChange={(v) => setEdit((e) => ({ ...e, camera: { ...e.camera, hide: !v } }))}
                  label="Show facecam"
                />
                <div
                  className={cn(edit.camera.hide && "pointer-events-none opacity-50", "space-y-3")}
                >
                  <div>
                    <Label htmlFor="studio-cam-pos">Position</Label>
                    <Select
                      id="studio-cam-pos"
                      className="mt-1"
                      value={edit.camera.position}
                      onChange={(e) =>
                        setEdit((s) => ({
                          ...s,
                          camera: { ...s.camera, position: e.target.value as Corner },
                        }))
                      }
                    >
                      {CORNERS.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <RangeField
                    id="studio-cam-size"
                    label={`Size · ${Math.round(edit.camera.size)}%`}
                    min={15}
                    max={60}
                    value={edit.camera.size}
                    onChange={(v) => setEdit((s) => ({ ...s, camera: { ...s.camera, size: v } }))}
                  />
                  <RangeField
                    id="studio-cam-round"
                    label={`Rounding · ${Math.round(edit.camera.rounding)}%`}
                    min={0}
                    max={100}
                    value={edit.camera.rounding}
                    onChange={(v) =>
                      setEdit((s) => ({ ...s, camera: { ...s.camera, rounding: v } }))
                    }
                  />
                  <Toggle
                    id="studio-cam-aspect"
                    checked={edit.camera.keepAspect}
                    onChange={(v) =>
                      setEdit((s) => ({ ...s, camera: { ...s.camera, keepAspect: v } }))
                    }
                    label="Keep camera aspect ratio"
                    description="Off = square crop."
                  />
                  <Toggle
                    id="studio-cam-mirror"
                    checked={edit.camera.mirror}
                    onChange={(v) => setEdit((s) => ({ ...s, camera: { ...s.camera, mirror: v } }))}
                    label="Mirror"
                  />
                </div>
              </>
            ) : (
              <p className="text-sm text-zinc-500">No camera track was recorded.</p>
            )}
          </Card>

          <Card className="space-y-3">
            <SectionTitle>Frame</SectionTitle>
            <div>
              <Label htmlFor="studio-aspect">Aspect ratio</Label>
              <Select
                id="studio-aspect"
                className="mt-1"
                value={edit.aspectRatio ?? "source"}
                onChange={(e) =>
                  setEdit((s) => ({
                    ...s,
                    aspectRatio:
                      e.target.value === "source"
                        ? null
                        : (e.target.value as NonNullable<StudioEdit["aspectRatio"]>),
                  }))
                }
              >
                <option value="source">Same as recording</option>
                <option value="wide">Wide 16:9</option>
                <option value="vertical">Vertical 9:16</option>
                <option value="square">Square 1:1</option>
                <option value="classic">Classic 4:3</option>
                <option value="tall">Tall 3:4</option>
              </Select>
            </div>
            <RangeField
              id="studio-padding"
              label={`Padding · ${Math.round(edit.padding)}%`}
              min={0}
              max={30}
              value={edit.padding}
              onChange={(v) => setEdit((s) => ({ ...s, padding: v }))}
            />
            <div>
              <Label htmlFor="studio-bg">Background</Label>
              <div className="mt-1 flex items-center gap-2">
                <Select
                  id="studio-bg"
                  value={edit.background.kind}
                  onChange={(e) =>
                    setEdit((s) => ({
                      ...s,
                      background:
                        e.target.value === "wallpaper"
                          ? { kind: "wallpaper" }
                          : { kind: "color", rgb: [0, 0, 0] },
                    }))
                  }
                >
                  <option value="color">Solid colour</option>
                  <option value="wallpaper">Cap wallpaper</option>
                </Select>
                {edit.background.kind === "color" ? (
                  <input
                    type="color"
                    aria-label="Background colour"
                    value={rgbToHex(edit.background.rgb)}
                    onChange={(e) =>
                      setEdit((s) => ({
                        ...s,
                        background: { kind: "color", rgb: hexToRgb(e.target.value) },
                      }))
                    }
                    className="h-9 w-12 cursor-pointer rounded-lg border border-zinc-800 bg-zinc-900"
                  />
                ) : null}
              </div>
            </div>
            <p className="text-xs text-zinc-500">
              Padding and aspect changes show only in the rendered video.
            </p>
          </Card>

          <Card>
            <SectionTitle>Project</SectionTitle>
            <dl className="space-y-1 text-xs text-zinc-500">
              <div className="flex justify-between gap-2">
                <dt>Display</dt>
                <dd className="text-zinc-300">{info.displayPath ? "yes" : "missing"}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>Camera</dt>
                <dd className="text-zinc-300">{info.cameraPath ? "yes" : "no"}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>Microphone</dt>
                <dd className="text-zinc-300">{info.micPath ? "yes" : "no"}</dd>
              </div>
            </dl>
            <p className="mt-2 flex items-center gap-1 text-[11px] text-zinc-600">
              <Clapperboard className="size-3" aria-hidden />
              Rendered with Cap's exporter.
            </p>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function RangeField({
  id,
  label,
  min,
  max,
  value,
  onChange,
}: {
  id: string;
  label: string;
  min: number;
  max: number;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full accent-emerald-500"
      />
    </div>
  );
}

/** Scrubber with kept ranges highlighted. */
function Timeline({
  duration,
  current,
  segments,
  markIn,
  onSeek,
}: {
  duration: number;
  current: number;
  segments: TimeRange[];
  markIn: number | null;
  onSeek: (t: number) => void;
}) {
  const pct = (t: number) =>
    `${duration > 0 ? (Math.max(0, Math.min(duration, t)) / duration) * 100 : 0}%`;
  return (
    <div className="space-y-1">
      <div className="relative h-6 w-full overflow-hidden rounded bg-zinc-800/80">
        {segments.length === 0 ? (
          <div className="absolute inset-0 bg-emerald-500/25" />
        ) : (
          segments.map((r) => (
            <div
              key={`${r.start}-${r.end}`}
              className="absolute inset-y-0 bg-emerald-500/40"
              style={{ left: pct(r.start), width: pct(r.end - r.start) }}
            />
          ))
        )}
        {markIn !== null ? (
          <div
            className="absolute inset-y-0 w-0.5 bg-amber-400"
            style={{ left: pct(markIn) }}
            aria-hidden
          />
        ) : null}
        <div
          className="absolute inset-y-0 w-0.5 bg-white"
          style={{ left: pct(current) }}
          aria-hidden
        />
      </div>
      <input
        type="range"
        aria-label="Playhead"
        min={0}
        max={Math.max(0.1, duration)}
        step={0.05}
        value={current}
        onChange={(e) => onSeek(Number(e.target.value))}
        className="w-full accent-emerald-500"
      />
    </div>
  );
}
