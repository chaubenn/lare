import { formatDurationHuman, showsActiveTime } from "@lare/shared";
import { RefreshCw, Sparkles, SquarePen, Video as VideoIcon } from "@lare/ui/icons";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { AiReviewSection } from "@/components/AiReviewSection";
import { ProblemSection } from "@/components/ProblemSection";
import { KindBadge, SessionStatusBadge } from "@/components/ui/Badge";
import { Button, buttonClass } from "@/components/ui/Button";
import { Card, SectionTitle } from "@/components/ui/Card";
import { EmptyState, ErrorState, PageSpinner, Spinner } from "@/components/ui/States";
import { VideoEmbed } from "@/components/VideoEmbed";
import { useVideo } from "@/features/media/hooks";
import { isActive, useJobs } from "@/features/media/jobs";
import { useFailedTranscription, useUnfinishedInterviews } from "@/features/media/recovery";
import { useNotify } from "@/features/notifications/notices";
import { useInterviewReview } from "@/features/publishing/posts/queries";
import { formatDateTime, plural } from "@/lib/format";
import { errorMessage, invokeFunction } from "@/lib/supabase";
import { CodeTimeline } from "./CodeTimeline";
import { lastEditAt } from "./editLog";
import { TranscriptionRetry, UnfinishedInterviewRow } from "./InterviewRecovery";
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
import { ReviewCriteria } from "./ReviewCriteria";
import { Timeline, type TimelineMarker } from "./Timeline";
import { TranscriptList } from "./TranscriptList";
import { useCreateSessionDraft } from "./useCreateSessionDraft";

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
          <Link to="/sessions" className="text-sm text-zinc-200 underline underline-offset-2">
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
  const { notify } = useNotify();
  const navigate = useNavigate();
  const isInterview = session.kind === "interview";
  // A take of this session still on this computer: one that never uploaded, or one whose
  // transcription failed (the only way to tell that apart from choosing "video only").
  const [unfinishedTake] = useUnfinishedInterviews(session.id).list;
  const failedTake = useFailedTranscription(session.id);
  const transcriptionFailed = isInterview && !session.graded && failedTake !== null;
  const processing = useJobs().some((job) => isActive(job) && job.sessionId === session.id);
  const createDraft = useCreateSessionDraft();

  const post = useSessionPost(session.id);
  const transcript = useSessionTranscript(session.id);
  const review = useInterviewReview(session.graded ? session.id : null);
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
  const segments = session.graded ? (transcript.data?.segments ?? null) : null;

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

  const hasTranscript = (segments?.length ?? 0) > 0;
  const generateBlocked = !isInterview
    ? "AI review is only available for mock interviews."
    : !session.graded
      ? "This interview was recorded without transcript and AI review."
      : transcript.isPending
        ? null
        : !hasTranscript
          ? "Local transcription must finish before this interview can be graded."
          : null;

  const generate = useMutation({
    mutationFn: (force: boolean) =>
      invokeFunction<unknown>(
        "ai-review",
        force ? { sessionId: session.id, force: true } : { sessionId: session.id },
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["interview-review", session.id] });
      notify({ title: "AI review ready", variant: "success" });
    },
    onError: (e) =>
      notify({
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
  // An ended session the extension never made a post for (or whose post was deleted).
  const canCreateDraft =
    !post.isPending &&
    !post.isError &&
    !post.data &&
    session.status === "ended" &&
    !session.is_practice_inbox;
  const doCreateDraft = () =>
    createDraft.mutate(session.id, {
      onSuccess: (postId) => void navigate(`/drafts/${postId}`),
      onError: (e) =>
        notify({
          title: "Couldn't create a draft",
          description: errorMessage(e),
          variant: "error",
        }),
    });

  return (
    <div className="space-y-5">
      <header>
        <div className="flex items-start justify-between gap-4">
          <h1 className="select-text text-2xl font-semibold text-[var(--text)]">{title}</h1>
          {postLink ? (
            <Link to={postLink.to} className={buttonClass("secondary", "sm")}>
              {postLink.label}
            </Link>
          ) : canCreateDraft ? (
            <Button
              size="sm"
              variant="secondary"
              icon={<SquarePen className="size-3.5" aria-hidden />}
              loading={createDraft.isPending}
              onClick={doCreateDraft}
            >
              Create draft
            </Button>
          ) : null}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-zinc-400">
          <KindBadge kind={session.kind} />
          <SessionStatusBadge status={session.status} />
          {isInterview && (
            <span>
              {session.graded
                ? "Local transcript & AI review"
                : transcriptionFailed
                  ? "Transcription failed"
                  : "No transcript: video only"}
            </span>
          )}
          {showsActiveTime(session.kind, session.active_ms) ? (
            <>
              <span>{formatDurationHuman(session.active_ms)} active</span>
              <span aria-hidden>·</span>
            </>
          ) : null}
          <span>started {formatDateTime(session.started_at)}</span>
          <span aria-hidden>·</span>
          <span>{plural(problems.length, "problem")}</span>
        </div>
        {isInterview && !videoPending && !video.data ? (
          <p className="mt-2 text-xs text-[var(--text-tertiary)]">
            The desktop app uploads the interview after it stops recording.
          </p>
        ) : null}
      </header>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* The recording and its scrubber stay in view while the code and transcript scroll past,
            so the left column is never an empty gap beside a long right one. */}
        <div className="space-y-4 lg:sticky lg:top-0 lg:self-start">
          <section aria-label="Recording">
            {video.data ? (
              <>
                <VideoEmbed video={video.data} title={title} startAt={seekTarget ?? undefined} />
                {video.data.status === "ready" ? (
                  <p className="mt-1.5 text-xs text-[var(--text-tertiary)]">
                    Seeking re-loads the player at the chosen time.
                  </p>
                ) : null}
              </>
            ) : videoPending ? (
              <div className="flex aspect-video w-full items-center justify-center rounded-[var(--lare-r-4)] border border-[var(--border)] bg-black">
                <Spinner label="Loading video…" />
              </div>
            ) : video.isError || latestVideo.isError ? (
              <ErrorState
                error={video.error ?? latestVideo.error}
                onRetry={() => void (video.isError ? video.refetch() : latestVideo.refetch())}
                title="Couldn't load the video"
              />
            ) : isInterview && unfinishedTake ? (
              <Card>
                <SectionTitle>Not uploaded yet</SectionTitle>
                <p className="mb-3 text-sm text-[var(--text-secondary)]">
                  The recording is on this computer but didn't finish uploading.
                </p>
                <UnfinishedInterviewRow recording={unfinishedTake} />
              </Card>
            ) : (
              <EmptyState
                icon={<VideoIcon className="size-6" aria-hidden />}
                title="No video"
                description={
                  !isInterview
                    ? "No recording was made for this session."
                    : processing
                      ? "Lare is processing this interview now. It shows here once it's uploaded."
                      : "The desktop app uploads the interview after it stops recording. If it was recorded on another computer, open Lare there to finish the upload."
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
        </div>

        <div className="space-y-4">
          <CodeTimeline
            problems={problems}
            logs={logs}
            t0={t0}
            currentTime={currentTime}
            onJump={scrubTo}
          />

          {session.graded && (
            <TranscriptList
              segments={segments}
              model={transcript.data?.row.model}
              isPending={transcript.isPending}
              error={transcript.error}
              onRetry={() => void transcript.refetch()}
              currentTime={currentTime}
              onSeek={seekTo}
            />
          )}
        </div>
      </div>

      {/* Full width, below the recording and the code: the review is a dashboard of its own, and
          beside the video it left the other column empty as it grew. */}
      <section aria-label="AI review" className="space-y-4">
        {transcriptionFailed && failedTake ? (
          <Card>
            <SectionTitle>AI review</SectionTitle>
            <TranscriptionRetry recording={failedTake} />
          </Card>
        ) : !isInterview || !session.graded ? (
          <Card>
            <SectionTitle>AI review</SectionTitle>
            <p className="text-sm text-zinc-400">{generateBlocked}</p>
          </Card>
        ) : review.isPending ? (
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
            <div className="flex flex-col items-center gap-3 rounded-[var(--lare-r-2)] border border-dashed border-[var(--border)] px-4 py-8 text-center">
              <Sparkles className="size-6 text-[var(--text-tertiary)]" aria-hidden />
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
                <p className="text-xs text-[var(--text-tertiary)]">
                  This usually takes about a minute.
                </p>
              ) : generateBlocked ? (
                <p className="text-xs text-[var(--text-tertiary)]">{generateBlocked}</p>
              ) : null}
            </div>
          </Card>
        )}
        {isInterview && session.graded ? <ReviewCriteria /> : null}
      </section>

      <section className="space-y-3">
        <SectionTitle>Problems</SectionTitle>
        {problems.length === 0 ? (
          <p className="text-sm text-[var(--text-tertiary)]">
            No problems were captured in this session.
          </p>
        ) : (
          problems.map((p) => <ProblemSection key={p.id} problem={p} />)
        )}
      </section>
    </div>
  );
}
