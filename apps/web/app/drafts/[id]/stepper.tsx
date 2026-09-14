"use client";

import type { Post, Video } from "@lare/supabase-types";
import { Button, Card, Input, Label, Select, Textarea } from "@lare/ui/primitives";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useEffectEvent, useRef, useState, useTransition } from "react";
import { BrowserRecorder } from "@/components/browser-recorder";
import { DesktopCapability } from "@/components/desktop-capability";
import { VideoEmbed } from "@/components/video-embed";
import { type DraftEdit, DraftEditSchema, validateDraftStep } from "@/lib/drafts";
import { saveDraft } from "../actions";

const steps = ["Problems", "Media", "Details", "Extras", "Review & publish"];

export function DraftStepper({
  post,
  videos,
  problemCount,
  interview,
  hasReview,
  problems,
}: {
  post: Post;
  videos: Video[];
  problemCount: number;
  interview: boolean;
  hasReview: boolean;
  problems: ReactNode;
}) {
  const router = useRouter();
  const [edit, setEdit] = useState<DraftEdit>(() =>
    DraftEditSchema.parse({
      ...post,
      title: post.title ?? "",
      body: post.body ?? "",
      include_ai_insights: hasReview && post.include_ai_insights,
      og_show_ai_scores: hasReview && post.og_show_ai_scores,
    }),
  );
  const latest = useRef(edit);
  const saved = useRef(JSON.stringify(edit));
  const queue = useRef<Promise<boolean>>(Promise.resolve(true));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const storageKey = `lare:draft:${post.user_id}:${post.id}`;
  const [recovery, setRecovery] = useState<DraftEdit | null>(null);
  const [step, setStep] = useState(0);
  const [status, setStatus] = useState("All changes saved");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, startTransition] = useTransition();

  const navigateAfterSave = useEffectEvent((event: MouseEvent) => {
    if (event.defaultPrevented || busy || !(event.target instanceof Element)) return;
    const link = event.target.closest<HTMLAnchorElement>("a[href]");
    if (
      !link ||
      link.target === "_blank" ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      JSON.stringify(latest.current) === saved.current
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    if (timer.current) clearTimeout(timer.current);
    startTransition(async () => {
      if (!(await persist(latest.current))) return;
      const url = new URL(link.href);
      if (url.origin === window.location.origin)
        router.push(`${url.pathname}${url.search}${url.hash}`);
      else window.location.assign(url.href);
    });
  });

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = DraftEditSchema.safeParse(JSON.parse(raw));
        if (parsed.success && JSON.stringify(parsed.data) !== saved.current)
          setRecovery(parsed.data);
      }
    } catch {
      setStatus("Browser recovery storage is unavailable; keep this page open until saved.");
    }
    const unload = (event: BeforeUnloadEvent) => {
      if (JSON.stringify(latest.current) !== saved.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", unload);
    const navigate = (event: MouseEvent) => navigateAfterSave(event);
    document.addEventListener("click", navigate, true);
    return () => {
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("click", navigate, true);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [storageKey]);

  function persist(value: DraftEdit): Promise<boolean> {
    const snapshot = JSON.stringify(value);
    setStatus("Saving...");
    // Serialize snapshots so a slow earlier request cannot overwrite a newer edit.
    queue.current = queue.current
      .catch(() => false)
      .then(async () => {
        try {
          const result = await saveDraft(post.id, value);
          if (result.error) throw new Error(result.error);
          saved.current = snapshot;
          if (JSON.stringify(latest.current) === snapshot) {
            setStatus("All changes saved");
            try {
              localStorage.removeItem(storageKey);
            } catch {
              /* Server copy is safe. */
            }
          }
          return true;
        } catch (cause) {
          setStatus("Not saved. Retry before leaving.");
          setError(cause instanceof Error ? cause.message : "Could not save draft.");
          return false;
        }
      });
    return queue.current;
  }

  function change(patch: Partial<DraftEdit>) {
    const next = { ...latest.current, ...patch };
    latest.current = next;
    setEdit(next);
    setError(null);
    setStatus("Unsaved changes");
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      setStatus("Unsaved changes; browser recovery storage unavailable.");
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void persist(next);
    }, 400);
  }

  async function advance(target: number) {
    if (target > step) {
      for (let index = 0; index < target; index++) {
        const message = validateDraftStep(index, latest.current, problemCount, !!post.session_id);
        if (message) {
          setError(message);
          return;
        }
      }
    }
    if (timer.current) clearTimeout(timer.current);
    if (await persist(latest.current)) {
      setStep(target);
      setError(null);
    }
  }

  const attached = [edit.video_id, edit.demo_video_id].filter((id): id is string => !!id);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <Link href="/drafts" className="underline">
          All drafts
        </Link>
        <span role="status" aria-live="polite">
          {status}
        </span>
      </div>
      {recovery && (
        <Card className="space-y-2 p-4 text-sm">
          <p>
            This browser has unsaved edits for this draft. Restore them or keep the server version.
          </p>
          <Button
            type="button"
            onClick={() => {
              change(recovery);
              setRecovery(null);
            }}
          >
            Restore edits
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              try {
                localStorage.removeItem(storageKey);
                setRecovery(null);
              } catch {
                setError(
                  "Could not clear browser recovery storage. Restore the edits and save instead.",
                );
              }
            }}
          >
            Keep server version
          </Button>
        </Card>
      )}
      <nav aria-label="Draft steps" className="flex flex-wrap gap-2">
        {steps.map((label, index) => (
          <Button
            key={label}
            type="button"
            size="sm"
            variant={step === index ? "primary" : "ghost"}
            aria-current={step === index ? "step" : undefined}
            disabled={pending || busy || !!recovery}
            onClick={() => startTransition(() => advance(index))}
          >
            {index + 1}. {label}
          </Button>
        ))}
      </nav>
      <fieldset disabled={pending || !!recovery} className="min-w-0 space-y-4">
        <legend className="mb-3 text-lg font-medium">{steps[step]}</legend>
        {step === 0 && (
          <>
            <p className="text-sm text-[var(--text-secondary)]">
              {post.session_id
                ? `${problemCount} captured problems. Submissions and code stay with this session; review them before continuing.`
                : "General videos do not need a problem. To share tracked practice, select problems from the drafts page."}
            </p>
            {post.session_id && (
              <Link
                className="inline-block text-sm underline"
                href={`/sessions/${post.session_id}`}
              >
                Open full session timeline
              </Link>
            )}
            {problems}
          </>
        )}
        {step === 1 && (
          <>
            {interview && <DesktopCapability />}
            {!interview && (
              <div>
                <Label htmlFor="draft-video">General video</Label>
                <Select
                  id="draft-video"
                  className="mt-2 block w-full rounded bg-[var(--surface-raised)] p-2"
                  disabled={busy}
                  value={edit.video_id ?? ""}
                  onChange={(e) =>
                    change({ video_id: e.target.value || null, show_video: !!e.target.value })
                  }
                >
                  <option value="">No video attached</option>
                  {videos
                    .filter((v) => !v.session_id || v.session_id === post.session_id)
                    .map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.title || v.id} ({v.status})
                      </option>
                    ))}
                  {edit.video_id && !videos.some((v) => v.id === edit.video_id) && (
                    <option value={edit.video_id}>New browser recording (uploaded)</option>
                  )}
                </Select>
              </div>
            )}
            {post.session_id && (
              <div>
                <Label htmlFor="draft-summary">Summary video</Label>
                <Select
                  id="draft-summary"
                  className="mt-2 block w-full rounded bg-[var(--surface-raised)] p-2"
                  disabled={busy}
                  value={edit.demo_video_id ?? ""}
                  onChange={(e) =>
                    change({
                      demo_video_id: e.target.value || null,
                      show_demo_video: !!e.target.value,
                    })
                  }
                >
                  <option value="">No summary attached</option>
                  {videos
                    .filter(
                      (v) =>
                        v.id !== edit.video_id &&
                        (!v.session_id || v.session_id === post.session_id),
                    )
                    .map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.title || v.id} ({v.status})
                      </option>
                    ))}
                  {edit.demo_video_id && !videos.some((v) => v.id === edit.demo_video_id) && (
                    <option value={edit.demo_video_id}>New browser summary (uploaded)</option>
                  )}
                </Select>
              </div>
            )}
            <BrowserRecorder
              title={edit.title}
              sessionId={post.session_id}
              onBusy={setBusy}
              onComplete={(id) => {
                change(
                  post.session_id
                    ? { demo_video_id: id, show_demo_video: true }
                    : { video_id: id, show_video: true },
                );
                router.refresh();
              }}
            />
            {attached.map((id) => {
              const video = videos.find((v) => v.id === id);
              return (
                <div key={id} className="space-y-2">
                  {video && (
                    <VideoEmbed
                      videoId={id}
                      status={video.status}
                      bunnyVideoId={video.bunny_video_id}
                      durationMs={video.duration_ms}
                    />
                  )}
                  <Link className="text-sm underline" href={`/studio/${id}`}>
                    Trim / desktop studio options
                  </Link>
                </div>
              );
            })}
          </>
        )}
        {step === 2 && (
          <Card className="space-y-4 p-4">
            <div>
              <Label htmlFor="draft-title">Title</Label>
              <Input
                id="draft-title"
                className="mt-2 block w-full rounded bg-[var(--surface-raised)] p-2"
                value={edit.title}
                maxLength={140}
                onChange={(e) => change({ title: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="draft-body">Description</Label>
              <Textarea
                id="draft-body"
                className="mt-2 block min-h-40 w-full rounded bg-[var(--surface-raised)] p-2"
                value={edit.body}
                maxLength={5000}
                onChange={(e) => change({ body: e.target.value })}
              />
            </div>
            <p className="text-xs text-[var(--text-tertiary)]">
              {edit.body.length} / 5000 characters
            </p>
          </Card>
        )}
        {step === 3 && (
          <Card className="space-y-4 p-4">
            <div>
              <Label htmlFor="draft-visibility">Visibility</Label>
              <Select
                id="draft-visibility"
                className="ml-3 rounded bg-[var(--surface-raised)] p-2"
                value={edit.visibility}
                onChange={(e) => change({ visibility: e.target.value as DraftEdit["visibility"] })}
              >
                <option value="private">Private</option>
                <option value="public">Public</option>
              </Select>
            </div>
            {(
              [
                ["show_video", "Show full video", !edit.video_id],
                ["show_demo_video", "Show summary video", !edit.demo_video_id],
                ["include_ai_insights", "Include existing AI insights", !hasReview],
                ["include_og_card", "Generate a session / OG card", false],
                [
                  "og_show_ai_scores",
                  "Show AI scores on the card",
                  !hasReview || !edit.include_og_card,
                ],
              ] as const
            ).map(([key, label, disabled]) => (
              <label key={key} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={edit[key]}
                  onChange={(e) => change({ [key]: e.target.checked })}
                />
                {label}
              </label>
            ))}
            {!hasReview && (
              <p className="text-sm text-[var(--text-secondary)]">
                No AI review is available. Grading needs the desktop app running local Whisper
                during an extension interview, not a web transcription service.
              </p>
            )}
          </Card>
        )}
        {step === 4 && (
          <Card className="space-y-3 p-5">
            <h2 className="text-xl font-medium">{edit.title}</h2>
            <p className="whitespace-pre-wrap text-sm">{edit.body || "No description"}</p>
            <dl className="space-y-2 text-sm">
              <div>Visibility: {edit.visibility}</div>
              <div>Problems: {problemCount}</div>
              <div>
                Full video: {edit.video_id && edit.show_video ? "Included" : "Hidden / none"}
              </div>
              <div>
                Summary: {edit.demo_video_id && edit.show_demo_video ? "Included" : "Hidden / none"}
              </div>
              <div>
                AI insights: {hasReview && edit.include_ai_insights ? "Included" : "Not included"}
              </div>
              <div>OG card: {edit.include_og_card ? "Generated on publish" : "Off"}</div>
            </dl>
            <p className="text-sm text-[var(--text-tertiary)]">
              Publishing shares this post according to its visibility. Video playback may still be
              encoding after the upload completes.
            </p>
          </Card>
        )}
      </fieldset>
      {error && (
        <p role="alert" className="text-sm text-rose-300">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="ghost"
          disabled={step === 0 || pending || busy || !!recovery}
          onClick={() => startTransition(() => advance(step - 1))}
        >
          Back
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={pending || busy || !!recovery}
          onClick={() =>
            startTransition(async () => {
              if (timer.current) clearTimeout(timer.current);
              setError(null);
              await persist(latest.current);
            })
          }
        >
          Save now
        </Button>
        {step < 4 ? (
          <Button
            type="button"
            disabled={pending || busy || !!recovery}
            onClick={() => startTransition(() => advance(step + 1))}
          >
            Continue
          </Button>
        ) : (
          <Button
            type="button"
            disabled={pending || busy || !!recovery}
            onClick={() =>
              startTransition(async () => {
                if (timer.current) clearTimeout(timer.current);
                if (!(await persist(latest.current))) return;
                try {
                  const result = await saveDraft(post.id, latest.current, true);
                  if (result.error) {
                    setError(result.error);
                    return;
                  }
                  if (result.href) {
                    router.push(result.href);
                    router.refresh();
                  }
                } catch (cause) {
                  setError(
                    cause instanceof Error
                      ? cause.message
                      : "Could not publish. Your draft is saved.",
                  );
                }
              })
            }
          >
            Publish {edit.visibility === "private" ? "privately" : "post"}
          </Button>
        )}
      </div>
    </div>
  );
}
