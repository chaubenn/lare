import { formatDurationHuman } from "@lare/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, RefreshCw, Sparkles, Video as VideoIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { AiReviewSection } from "@/components/AiReviewSection";
import { ProblemSection } from "@/components/ProblemSection";
import { useToast } from "@/components/toast/ToastProvider";
import { KindBadge, SessionStatusBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, SectionTitle } from "@/components/ui/Card";
import { EmptyState, ErrorState, PageSpinner, Spinner } from "@/components/ui/States";
import { VideoEmbed } from "@/components/VideoEmbed";
import { useInterviewReview } from "@/features/posts/queries";
import { useVideo } from "@/features/recording/hooks";
import { formatDateTime, plural } from "@/lib/format";
import { errorMessage, invokeFunction } from "@/lib/supabase";
import { CodeTimeline } from "./CodeTimeline";
import { lastEditAt } from "./editLog";
import {
  clampTime,
  epochToMedia,
  isoToMedia,
  type MediaClock,
  mediaClock,
  withKeys,
} from "./media";
import {
  type SessionDetail,
  useEditLogs,
  useLatestSessionVideo,
  useSession,
  useSessionPost,
  useSessionTranscript,
} from "./queries";
import { Timeline, type TimelineMarker } from "./Timeline";
import { TranscriptList } from "./TranscriptList";

export function SessionReviewPage() {
  const { id = "" } = useParams();
  const session = useSession(id);

  if (session.isPending) return <PageSpinner />;
  if (session.isError) {
    return <ErrorState error={session.error} onRetry={() => void session.refetch()} />;
  }
  if (!session.data) {
    return (
      <EmptyState
        title="Session not found"
        description="It may have been deleted, or it belongs to another account."
        action={
          <Link to="/sessions" className="text-sm text-emerald-400 hover:underline">
            Back to sessions
          </Link>
        }
      />
    );
  }
  return <SessionReview key={session.data.id} session={session.data} />;
}

function SessionReview({ session }: { session: SessionDetail }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const isInterview = session.kind === "interview";

  const post = useSessionPost(session.id);
  const transcript = useSessionTranscript(session.id);
  const review = useInterviewReview(session.id);
  // Prefer the video the post points at; otherwise the newest one uploaded for the session.
  const latestEnabled = !post.isPending && !post.data?.video_id;
  const latestVideo = useLatestSessionVideo(session.id, latestEnabled);
  const videoId = post.data?.video_id ?? latestVideo.data?.id ?? null;
  const video = useVideo(videoId);
  const videoPending =
    post.isPending ||
    (videoId !== null && video.isPending) ||
    (latestEnabled && latestVideo.isPending);

  const problems = useMemo(
    () =>
      [...session.session_problems].sort(
        (a, b) => Date.parse(a.opened_at) - Date.parse(b.opened_at),
      ),
    [session.session_problems],
  );
  const logs = useEditLogs(session.id, problems);
  const t0: MediaClock = useMemo(
    () => mediaClock(session, session.session_events ?? []),
    [session],
  );
  const segments = transcript.data?.segments ?? null;

  // One clock for the whole page (media seconds). `seekTarget` only changes on explicit seeks
  // (segment / marker / moment clicks, scrubber release) because it re-loads the player.
  const [currentTime, setCurrentTime] = useState(0);
  const [seekTarget, setSeekTarget] = useState<number | null>(null);

  // Cheap to recompute on every render; grows as edit logs and the video row arrive.
  const candidates = [session.active_ms / 1000, (video.data?.duration_ms ?? 0) / 1000];
  const lastSegment = segments?.[segments.length - 1];
  if (lastSegment) candidates.push(lastSegment.e / 1000);
  for (const q of logs) {
    const t = lastEditAt(q.data);
    if (t !== null) candidates.push(epochToMedia(t, t0));
  }
  for (const p of problems) {
    for (const s of p.submissions) candidates.push(isoToMedia(s.submitted_at, t0));
  }
  for (const m of review.data?.moments ?? []) candidates.push(m.t_ms / 1000);
  const duration = Math.max(0, ...candidates.filter((n) => Number.isFinite(n)));

  const scrubTo = (t: number) => setCurrentTime(clampTime(t, duration));
  const seekTo = (t: number) => {
    const clamped = clampTime(t, duration);
    setCurrentTime(clamped);
    setSeekTarget(clamped);
  };

  const submissionMarkers = useMemo<TimelineMarker[]>(
    () =>
      problems.flatMap((p) =>
        p.submissions.map((s) => ({
          key: s.id,
          t: Math.max(0, isoToMedia(s.submitted_at, t0)),
          tone: s.accepted ? "emerald" : "rose",
          label: `${p.title}: ${s.status_display ?? (s.accepted ? "Accepted" : "Not accepted")}`,
        })),
      ),
    [problems, t0],
  );
  const momentMarkers = useMemo<TimelineMarker[]>(
    () =>
      withKeys(review.data?.moments ?? [], (m) => `${m.t_ms}-${m.kind}`).map(({ key, item }) => ({
        key,
        t: item.t_ms / 1000,
        tone: item.kind === "good" ? "emerald" : item.kind === "issue" ? "rose" : "sky",
        label: `${item.kind}: ${item.comment}`,
      })),
    [review.data],
  );

  const hasEditLogs = problems.some((p) => !!p.edits_path);
  const hasTranscript = (segments?.length ?? 0) > 0;
  const generateBlocked = !isInterview
    ? "AI review is only available for mock interviews."
    : transcript.isPending
      ? null
      : !hasTranscript && !hasEditLogs
        ? "Nothing to review yet — no transcript or code edits were captured for this session."
        : null;

  const generate = useMutation({
    mutationFn: (force: boolean) =>
      invokeFunction<unknown>(
        "ai-review",
        force ? { sessionId: session.id, force: true } : { sessionId: session.id },
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["interview-review", session.id] });
      toast({ title: "AI review ready", variant: "success" });
    },
    onError: (e) =>
      toast({
        title: "Couldn't generate the review",
        description: errorMessage(e),
        variant: "error",
      }),
  });

  const title = post.data?.title || (isInterview ? "Mock interview" : "Practice session");
  const postLink = post.data
    ? post.data.status === "draft"
      ? { to: `/drafts/${post.data.id}`, label: "Open draft" }
      : { to: `/posts/${post.data.id}`, label: "View post" }
    : null;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <Link
          to="/sessions"
          className="inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-zinc-200"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Sessions
        </Link>
        {postLink ? (
          <Link
            to={postLink.to}
            className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-100 hover:bg-zinc-800"
          >
            {postLink.label}
          </Link>
        ) : null}
      </div>

      <header>
        <h1 className="select-text text-2xl font-semibold text-zinc-50">{title}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-zinc-400">
          <KindBadge kind={session.kind} />
          <SessionStatusBadge status={session.status} />
          <span>{formatDurationHuman(session.active_ms)} active</span>
          <span aria-hidden>·</span>
          <span>started {formatDateTime(session.started_at)}</span>
          <span aria-hidden>·</span>
          <span>{plural(problems.length, "problem")}</span>
        </div>
        {isInterview && !videoPending && !video.data ? (
          <p className="mt-2 text-xs text-zinc-500">
            Processing did not finish?{" "}
            <Link to="/recordings" className="text-emerald-400 hover:underline">
              Resume from Recordings
            </Link>
            .
          </p>
        ) : null}
      </header>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-4">
          <section aria-label="Recording">
            {video.data ? (
              <>
                <VideoEmbed video={video.data} title={title} startAt={seekTarget ?? undefined} />
                {video.data.status === "ready" ? (
                  <p className="mt-1.5 text-xs text-zinc-500">
                    Seeking re-loads the player at the chosen time.
                  </p>
                ) : null}
              </>
            ) : videoPending ? (
              <div className="flex aspect-video w-full items-center justify-center rounded-xl border border-zinc-800 bg-black">
                <Spinner label="Loading video…" />
              </div>
            ) : video.isError || latestVideo.isError ? (
              <ErrorState
                error={video.error ?? latestVideo.error}
                onRetry={() => void (video.isError ? video.refetch() : latestVideo.refetch())}
                title="Couldn't load the video"
              />
            ) : (
              <EmptyState
                icon={<VideoIcon className="size-6" aria-hidden />}
                title="No video"
                description={
                  isInterview ? (
                    <>
                      The interview recording is processed automatically when the session ends. If
                      it did not finish, resume it from{" "}
                      <Link to="/recordings" className="text-emerald-400 hover:underline">
                        Recordings
                      </Link>
                      .
                    </>
                  ) : (
                    "No recording was made for this session."
                  )
                }
              />
            )}
          </section>

          <Timeline
            duration={duration}
            currentTime={currentTime}
            submissions={submissionMarkers}
            moments={momentMarkers}
            onScrub={scrubTo}
            onSeek={seekTo}
          />

          <TranscriptList
            segments={segments}
            model={transcript.data?.row.model}
            isPending={transcript.isPending}
            error={transcript.error}
            onRetry={() => void transcript.refetch()}
            currentTime={currentTime}
            onSeek={seekTo}
          />
        </div>

        <div className="space-y-4">
          <CodeTimeline
            problems={problems}
            logs={logs}
            t0={t0}
            currentTime={currentTime}
            onJump={scrubTo}
          />

          {review.isPending ? (
            <Card>
              <SectionTitle>AI review</SectionTitle>
              <Spinner className="py-8" label="Loading review…" />
            </Card>
          ) : review.isError ? (
            <ErrorState
              error={review.error}
              onRetry={() => void review.refetch()}
              title="Couldn't load the AI review"
            />
          ) : review.data ? (
            <div className="space-y-2">
              <AiReviewSection review={review.data} onSeek={(tMs) => seekTo(tMs / 1000)} />
              <div className="flex items-center justify-end">
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<RefreshCw className="size-3.5" aria-hidden />}
                  loading={generate.isPending}
                  onClick={() => generate.mutate(true)}
                  title="Run the review again (counts towards the daily limit)"
                >
                  {generate.isPending ? "Regenerating…" : "Regenerate"}
                </Button>
              </div>
            </div>
          ) : (
            <Card>
              <SectionTitle>AI review</SectionTitle>
              <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-zinc-800 px-4 py-8 text-center">
                <Sparkles className="size-6 text-zinc-600" aria-hidden />
                <p className="max-w-sm text-sm text-zinc-400">
                  Get a graded debrief of this interview: scores for communication, problem solving,
                  code quality, speed and correctness, plus timestamped moments and next steps.
                </p>
                <Button
                  variant="primary"
                  icon={<Sparkles className="size-4" aria-hidden />}
                  loading={generate.isPending}
                  disabled={generateBlocked !== null || transcript.isPending}
                  onClick={() => generate.mutate(false)}
                >
                  {generate.isPending ? "Generating…" : "Generate AI review"}
                </Button>
                {generate.isPending ? (
                  <p className="text-xs text-zinc-500">This usually takes about a minute.</p>
                ) : generateBlocked ? (
                  <p className="text-xs text-zinc-500">{generateBlocked}</p>
                ) : null}
              </div>
            </Card>
          )}
        </div>
      </div>

      <section className="space-y-3">
        <SectionTitle>Problems</SectionTitle>
        {problems.length === 0 ? (
          <p className="text-sm text-zinc-500">No problems were captured in this session.</p>
        ) : (
          problems.map((p) => <ProblemSection key={p.id} problem={p} />)
        )}
      </section>
    </div>
  );
}
