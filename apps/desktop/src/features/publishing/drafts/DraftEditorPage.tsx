import { formatDurationHuman } from "@lare/shared";
import type { Post } from "@lare/supabase-types";
import { ask } from "@tauri-apps/plugin-dialog";
import { ArrowLeft, ArrowRight, Check, Eye, Send, Trash2 } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ProblemSection } from "@/components/ProblemSection";
import { useToast } from "@/components/toast/ToastProvider";
import { KindBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input, Label, Select, Textarea, Toggle } from "@/components/ui/Field";
import { EmptyState, ErrorState, PageSpinner } from "@/components/ui/States";
import { useUser } from "@/features/auth/AuthProvider";
import { useRecorderStatus } from "@/features/media/hooks";
import { isActive, useJobs } from "@/features/media/jobs";
import { PostMediaPanel } from "@/features/publishing/posts/PostMediaPanel";
import { PostPreview, usePreviewSlides } from "@/features/publishing/posts/PostPreview";
import { PageActions } from "@/features/shell/PageActions";
import { copyText } from "@/lib/clipboard";
import { postWebUrl } from "@/lib/env";
import { formatDateTime, plural } from "@/lib/format";
import { useHotkey } from "@/lib/hotkeys";
import { errorMessage } from "@/lib/supabase";
import { inTauri } from "@/lib/tauri";
import { DemoVideoPanel } from "./DemoVideoPanel";
import { PostExtrasPanel } from "./PostExtrasPanel";
import {
  type Draft,
  type PublishInput,
  useDeleteDraft,
  useDraft,
  usePublishDraft,
  useSaveDraft,
} from "./queries";
import { draftStepError } from "./validation";

export function DraftEditorPage() {
  const { id = "" } = useParams();
  const draft = useDraft(id);

  if (draft.isPending) return <PageSpinner />;
  if (draft.isError) return <ErrorState error={draft.error} onRetry={() => void draft.refetch()} />;
  if (!draft.data) {
    return (
      <EmptyState
        title="Draft not found"
        description="It may have been published or deleted."
        action={
          <Link to="/drafts" className="text-sm text-zinc-200 underline underline-offset-2">
            Back to drafts
          </Link>
        }
      />
    );
  }
  if (draft.data.status === "published") {
    return (
      <EmptyState
        title="Already published"
        action={
          <Link
            to={`/posts/${draft.data.id}`}
            className="text-sm text-zinc-200 underline underline-offset-2"
          >
            View the post
          </Link>
        }
      />
    );
  }
  return <DraftEditor key={draft.data.id} draft={draft.data} />;
}

/** The wizard's steps. Order is load-bearing: `draftStepError` validates by index. */
const STEPS = [
  { label: "Problems", hint: "What you solved in this session." },
  { label: "Media", hint: "The recording, a summary video and photos for the post." },
  { label: "Details", hint: "Title and write-up." },
  { label: "Extras", hint: "Who sees it and what the post includes." },
  { label: "Review & publish", hint: "Check it over, then publish." },
] as const;

function defaultTitle(draft: Draft): string {
  if (draft.title) return draft.title;
  const problems = draft.sessions?.session_problems ?? [];
  const kind = draft.sessions?.kind === "interview" ? "Mock interview" : "Practice";
  if (problems.length === 0) return kind;
  const titles = problems.slice(0, 3).map((p) => p.title);
  const more = problems.length > 3 ? ` +${problems.length - 3}` : "";
  return `${kind}: ${titles.join(", ")}${more}`;
}

async function confirmDelete(): Promise<boolean> {
  const message = "Delete this draft? The session data stays; only the post is removed.";
  if (inTauri) {
    return ask(message, {
      title: "Delete draft",
      kind: "warning",
      okLabel: "Delete",
      cancelLabel: "Keep",
    });
  }
  return window.confirm(message);
}

function DraftEditor({ draft }: { draft: Draft }) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { userId } = useUser();
  const publish = usePublishDraft();
  const save = useSaveDraft();
  const remove = useDeleteDraft();
  const recording = useRecorderStatus();
  const jobs = useJobs();

  const recoveryKey = `lare:draft:${userId}:${draft.id}`;
  const [recovered] = useState<Partial<PublishInput>>(() => {
    try {
      const value: unknown = JSON.parse(localStorage.getItem(recoveryKey) ?? "{}");
      if (!value || typeof value !== "object") return {};
      const draft = value as Partial<PublishInput>;
      return typeof draft.title === "string" &&
        typeof draft.body === "string" &&
        ["public", "private"].includes(draft.visibility ?? "") &&
        typeof draft.showVideo === "boolean" &&
        typeof draft.showDemoVideo === "boolean" &&
        (draft.coverMediaId === null || typeof draft.coverMediaId === "string")
        ? draft
        : {};
    } catch {
      return {};
    }
  });
  const [step, setStep] = useState(0);
  // Furthest step reached, so finished steps stay one click away.
  const [reached, setReached] = useState(0);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const leaving = useRef(false);

  const [title, setTitle] = useState(() => recovered.title ?? defaultTitle(draft));
  const [body, setBody] = useState(recovered.body ?? draft.body ?? "");
  const [visibility, setVisibility] = useState<Post["visibility"]>(
    recovered.visibility ?? draft.visibility,
  );
  const [showVideo, setShowVideo] = useState(recovered.showVideo ?? draft.show_video);
  const [showDemoVideo, setShowDemoVideo] = useState(
    recovered.showDemoVideo ?? draft.show_demo_video,
  );
  const [coverMediaId, setCoverMediaId] = useState<string | null>(
    recovered.coverMediaId !== undefined ? recovered.coverMediaId : draft.cover_media_id,
  );
  const [previewing, setPreviewing] = useState(false);

  const session = draft.sessions;
  const problems = session?.session_problems ?? [];
  const busy = publish.isPending || save.isPending || remove.isPending;
  const hasVideo = Boolean(draft.video_id) && draft.video_kind !== "none";
  const hasDemoVideo = Boolean(draft.demo_video_id);
  // Photos are written as soon as they are uploaded; the rest of the post is saved by the form.
  const edit = {
    id: draft.id,
    title,
    body,
    visibility,
    showVideo,
    showDemoVideo,
    coverMediaId,
  };
  const snapshot = JSON.stringify(edit);
  const latestSnapshot = useRef(snapshot);
  latestSnapshot.current = snapshot;
  const saveDraft = save.mutateAsync;
  useEffect(() => {
    if (leaving.current) return;
    setSaved(false);
    try {
      localStorage.setItem(recoveryKey, snapshot);
    } catch {
      setSaveError("Local recovery is unavailable. Keep this page open until cloud save succeeds.");
    }
    const timer = window.setTimeout(() => {
      if (leaving.current) return;
      void saveDraft(JSON.parse(snapshot) as PublishInput)
        .then(() => {
          if (latestSnapshot.current === snapshot) {
            setSaveError(null);
            setSaved(true);
          }
          try {
            if (localStorage.getItem(recoveryKey) === snapshot)
              localStorage.removeItem(recoveryKey);
          } catch {
            /* Cloud save succeeded. */
          }
        })
        .catch((error: unknown) => {
          setSaveError(errorMessage(error));
          setSaved(false);
        });
    }, 600);
    return () => window.clearTimeout(timer);
  }, [snapshot, recoveryKey, saveDraft]);

  const validate = () => {
    const error = draftStepError(step, {
      title,
      body,
      visibility,
      recording: recording.postId === draft.id && !["idle", "error"].includes(recording.state),
      uploading: jobs.some(
        (job) =>
          isActive(job) &&
          (job.postId === draft.id || (!!draft.session_id && job.sessionId === draft.session_id)),
      ),
    });
    if (error) {
      toast({ title: error, variant: "error" });
      return false;
    }
    return true;
  };
  const advance = async () => {
    if (!validate()) return;
    try {
      await saveDraft(edit);
      const next = Math.min(STEPS.length - 1, step + 1);
      setStep(next);
      setReached((r) => Math.max(r, next));
    } catch (error) {
      setSaveError(errorMessage(error));
    }
  };
  const slides = usePreviewSlides({
    postId: draft.id,
    videoId: draft.video_id,
    videoKind: draft.video_kind,
    showVideo,
    demoVideoId: draft.demo_video_id,
    showDemoVideo,
    includeOgCard: draft.include_og_card,
    coverMediaId,
    session,
  });

  const doPublish = async () => {
    if (busy || step !== 4 || !validate()) return;
    try {
      leaving.current = true;
      await saveDraft(edit);
      const { id, slug } = await publish.mutateAsync(edit);
      try {
        localStorage.removeItem(recoveryKey);
      } catch {
        /* Publication already succeeded. */
      }
      const copied = await copyText(postWebUrl(slug));
      toast({
        title: copied ? "Published — link copied" : "Published",
        description: copied ? postWebUrl(slug) : undefined,
        variant: "success",
      });
      void navigate(`/posts/${id}`, { replace: true });
    } catch (err) {
      leaving.current = false;
      toast({ title: "Couldn't publish", description: errorMessage(err), variant: "error" });
    }
  };

  const doSave = async () => {
    try {
      await save.mutateAsync(edit);
      toast({ title: "Draft saved", variant: "success" });
    } catch (err) {
      toast({ title: "Couldn't save", description: errorMessage(err), variant: "error" });
    }
  };

  const doDelete = async () => {
    if (!(await confirmDelete())) return;
    try {
      leaving.current = true;
      await saveDraft(edit);
      await remove.mutateAsync(draft.id);
      try {
        localStorage.removeItem(recoveryKey);
      } catch {
        /* Deletion already succeeded. */
      }
      toast({ title: "Draft deleted" });
      void navigate("/drafts", { replace: true });
    } catch (err) {
      leaving.current = false;
      toast({ title: "Couldn't delete", description: errorMessage(err), variant: "error" });
    }
  };

  useHotkey({ key: "Enter", mod: true }, () => void doPublish());

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (step === 4) void doPublish();
    else void advance();
  };

  const saveState = saveError ? "error" : saved ? "saved" : "saving";

  return (
    <div className="w-full">
      <Link
        to="/drafts"
        className="inline-flex items-center gap-1 rounded-[var(--lare-r-1)] text-sm text-[var(--text-secondary)] hover:text-[var(--text)] focus-visible:outline-2 focus-visible:outline-[var(--focus)]"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Drafts
      </Link>

      <div className="mt-4 grid gap-8 lg:grid-cols-[15rem_minmax(0,64rem)]">
        {/* ---- Step rail: where you are, what's left, and what this draft is ---- */}
        <aside className="lg:sticky lg:top-0 lg:self-start">
          <p className="truncate text-sm font-semibold text-[var(--text)]" title={title}>
            {title || "Untitled draft"}
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--text-secondary)]">
            {session ? <KindBadge kind={session.kind} /> : null}
            <span>{plural(problems.length, "problem")}</span>
            {session && session.active_ms > 0 ? (
              <span>· {formatDurationHuman(session.active_ms)}</span>
            ) : null}
          </p>
          {session ? (
            <p className="mt-1 text-xs text-[var(--text-tertiary)]">
              {formatDateTime(session.started_at)}
            </p>
          ) : null}

          {/* Narrow windows: a compact progress bar instead of the full list. */}
          <div className="mt-4 lg:hidden">
            <p className="text-xs text-[var(--text-secondary)]">
              Step {step + 1} of {STEPS.length}
            </p>
            <div className="mt-1.5 flex gap-1" aria-hidden>
              {STEPS.map((s, index) => (
                <span
                  key={s.label}
                  className={`h-1 flex-1 rounded-full ${index <= step ? "bg-[var(--accent)]" : "bg-[var(--border-strong)]"}`}
                />
              ))}
            </div>
          </div>

          <nav aria-label="Draft steps" className="mt-6 hidden lg:block">
            <ol className="space-y-1">
              {STEPS.map((s, index) => {
                const state = index === step ? "current" : index < reached ? "done" : "todo";
                const reachable = index <= reached && !busy;
                return (
                  <li key={s.label}>
                    <button
                      type="button"
                      aria-current={state === "current" ? "step" : undefined}
                      disabled={!reachable}
                      onClick={() => setStep(index)}
                      className={`flex w-full items-start gap-3 rounded-[var(--lare-r-2)] px-2 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-[var(--focus)] disabled:cursor-default ${
                        state === "current"
                          ? "bg-[var(--surface-raised)]"
                          : reachable
                            ? "hover:bg-[color-mix(in_oklab,var(--surface-raised)_60%,transparent)]"
                            : ""
                      }`}
                    >
                      <span
                        className={`mt-px grid size-5 shrink-0 place-items-center rounded-full border text-[11px] font-semibold tabular-nums ${
                          state === "current"
                            ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-fg)]"
                            : state === "done"
                              ? "border-[var(--border-strong)] text-[var(--text)]"
                              : "border-[var(--border)] text-[var(--text-tertiary)]"
                        }`}
                      >
                        {state === "done" ? <Check className="size-3" aria-hidden /> : index + 1}
                      </span>
                      <span className="min-w-0">
                        <span
                          className={`block text-sm ${state === "todo" ? "text-[var(--text-tertiary)]" : "text-[var(--text)]"}`}
                        >
                          {s.label}
                        </span>
                        {state === "current" ? (
                          <span className="block text-xs text-[var(--text-secondary)]">
                            {s.hint}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>

          <p
            role="status"
            className={`mt-6 flex items-start gap-2 text-xs ${saveState === "error" ? "text-[var(--lare-danger)]" : "text-[var(--text-tertiary)]"}`}
          >
            <span
              aria-hidden
              className={`mt-1 size-1.5 shrink-0 rounded-full ${
                saveState === "error"
                  ? "bg-[var(--lare-danger)]"
                  : saveState === "saved"
                    ? "bg-[var(--lare-status-run)]"
                    : "bg-[var(--lare-status-pause)]"
              }`}
            />
            {saveState === "error"
              ? `Cloud save failed: ${saveError}. Changes are kept on this device; use Save draft to retry.`
              : saveState === "saved"
                ? "Saved to cloud"
                : "Saving…"}
          </p>

          <button
            type="button"
            onClick={() => void doDelete()}
            disabled={busy}
            className="mt-4 inline-flex items-center gap-1.5 rounded-[var(--lare-r-1)] text-xs text-[var(--text-tertiary)] hover:text-[var(--lare-danger)] focus-visible:outline-2 focus-visible:outline-[var(--focus)] disabled:opacity-50"
          >
            <Trash2 className="size-3.5" aria-hidden />
            Delete draft
          </button>
        </aside>

        {/* ---- The current step ---- */}
        <form id="draft-editor-form" onSubmit={onSubmit} className="min-w-0">
          <header className="mb-5">
            {/* The narrow layout already shows this above its progress bar. */}
            <p className="mb-1 hidden text-xs font-medium text-[var(--text-secondary)] lg:block">
              Step {step + 1} of {STEPS.length}
            </p>
            <h1 className="lare-title text-[var(--text)]">{STEPS[step]?.label}</h1>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">{STEPS[step]?.hint}</p>
          </header>

          <div className="space-y-4">
            {step === 0 ? (
              problems.length === 0 ? (
                <p className="rounded-[var(--lare-r-4)] border border-dashed border-[var(--border)] p-6 text-sm text-[var(--text-secondary)]">
                  No problems were captured in this session. That's fine for a general post:
                  continue to add media and a write-up.
                </p>
              ) : (
                problems.map((p) => <ProblemSection key={p.id} problem={p} />)
              )
            ) : null}

            {step === 1 ? (
              <>
                <DemoVideoPanel draft={draft} />
                <PostMediaPanel
                  postId={draft.id}
                  userId={userId}
                  coverMediaId={coverMediaId}
                  onCoverChange={setCoverMediaId}
                  disabled={busy}
                />
              </>
            ) : null}

            {step === 2 ? (
              <Card className="space-y-4">
                <div>
                  <Label htmlFor="draft-title" hint={`${title.length}/140`}>
                    Title
                  </Label>
                  <Input
                    id="draft-title"
                    className="mt-1"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    maxLength={140}
                    placeholder="Give this session a title"
                  />
                </div>
                <div>
                  <Label htmlFor="draft-body">Write-up</Label>
                  <Textarea
                    id="draft-body"
                    className="mt-1 min-h-48"
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder="What did you learn? What was the approach?"
                    maxLength={5000}
                  />
                </div>
              </Card>
            ) : null}

            {step === 3 ? (
              <>
                <Card className="space-y-4">
                  <div>
                    <Label htmlFor="draft-visibility">Who can see it</Label>
                    <Select
                      id="draft-visibility"
                      className="mt-1"
                      value={visibility}
                      onChange={(e) => setVisibility(e.target.value as Post["visibility"])}
                    >
                      <option value="public">
                        Followers and everyone (if your account is public)
                      </option>
                      <option value="private">Only me</option>
                    </Select>
                  </div>
                  {hasDemoVideo ? (
                    <Toggle
                      id="draft-show-summary-video"
                      checked={showDemoVideo}
                      onChange={setShowDemoVideo}
                      label="Show the summary video on the post"
                      description="Adds the debrief clip to the carousel, ahead of the full recording."
                    />
                  ) : null}
                  {hasVideo ? (
                    <Toggle
                      id="draft-show-video"
                      checked={showVideo}
                      onChange={setShowVideo}
                      label="Show the demo video on the post"
                      description="Adds the recording as the last slide of the post's carousel."
                    />
                  ) : null}
                </Card>
                <PostExtrasPanel draft={draft} />
              </>
            ) : null}

            {step === 4 ? (
              <Card className="space-y-3">
                <h2 className="lare-heading text-[var(--text)]">{title || "Untitled draft"}</h2>
                <p className="whitespace-pre-wrap text-sm text-[var(--text-secondary)]">
                  {body || "No write-up."}
                </p>
                <dl className="grid gap-x-6 gap-y-2 border-t border-[var(--border)] pt-3 text-sm sm:grid-cols-2">
                  {[
                    ["Visibility", visibility === "private" ? "Only you" : "Public"],
                    ["Problems", String(problems.length)],
                    ["Recording", hasVideo ? (showVideo ? "Shown" : "Attached, hidden") : "None"],
                    [
                      "Summary video",
                      hasDemoVideo ? (showDemoVideo ? "Shown" : "Attached, hidden") : "None",
                    ],
                  ].map(([term, value]) => (
                    <div key={term} className="flex justify-between gap-3">
                      <dt className="text-[var(--text-secondary)]">{term}</dt>
                      <dd className="text-[var(--text)]">{value}</dd>
                    </div>
                  ))}
                </dl>
              </Card>
            ) : null}
          </div>

          {/* ---- One action bar for every step, across the whole content pane ---- */}
          {/* Rail 15rem + gap 2rem + form 64rem + the bar's own 2.5rem gutters. */}
          <PageActions className="max-w-[83.5rem]">
            <Button
              variant="ghost"
              icon={<ArrowLeft className="size-4" aria-hidden />}
              disabled={step === 0 || busy}
              onClick={() => setStep((s) => s - 1)}
            >
              Back
            </Button>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="ghost"
                icon={<Eye className="size-4" aria-hidden />}
                onClick={() => setPreviewing(true)}
              >
                Preview
              </Button>
              <Button variant="secondary" onClick={() => void doSave()} disabled={busy}>
                Save draft
              </Button>
              {step < STEPS.length - 1 ? (
                <Button type="submit" form="draft-editor-form" variant="primary" disabled={busy}>
                  Continue to {STEPS[step + 1]?.label}
                  <ArrowRight className="size-4" aria-hidden />
                </Button>
              ) : (
                <Button
                  type="submit"
                  form="draft-editor-form"
                  variant="primary"
                  icon={<Send className="size-4" aria-hidden />}
                  loading={publish.isPending}
                  disabled={busy}
                  title="⌘/Ctrl + Enter"
                >
                  Publish
                </Button>
              )}
            </div>
          </PageActions>
        </form>
      </div>

      {previewing && (
        <PostPreview
          title={title}
          body={body}
          visibility={visibility}
          when={draft.created_at}
          published={false}
          slides={slides}
          onClose={() => setPreviewing(false)}
        />
      )}
    </div>
  );
}
