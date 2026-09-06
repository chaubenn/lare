import { formatDurationHuman } from "@lare/shared";
import type { Post } from "@lare/supabase-types";
import { ask } from "@tauri-apps/plugin-dialog";
import { ArrowLeft, Eye, Send, Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ProblemSection } from "@/components/ProblemSection";
import { useToast } from "@/components/toast/ToastProvider";
import { KindBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, SectionTitle } from "@/components/ui/Card";
import { Input, Label, Select, Textarea, Toggle } from "@/components/ui/Field";
import { EmptyState, ErrorState, PageSpinner } from "@/components/ui/States";
import { useUser } from "@/features/auth/AuthProvider";
import { PostMediaPanel } from "@/features/posts/PostMediaPanel";
import { PostPreview, usePreviewSlides } from "@/features/posts/PostPreview";
import { copyText } from "@/lib/clipboard";
import { postWebUrl } from "@/lib/env";
import { formatDateTime, plural } from "@/lib/format";
import { useHotkey } from "@/lib/hotkeys";
import { errorMessage } from "@/lib/supabase";
import { inTauri } from "@/lib/tauri";
import { DemoVideoPanel } from "./DemoVideoPanel";
import { PostExtrasPanel } from "./PostExtrasPanel";
import { type Draft, useDeleteDraft, useDraft, usePublishDraft, useSaveDraft } from "./queries";

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
          <Link to={`/posts/${draft.data.id}`} className="text-sm text-zinc-200 underline underline-offset-2">
            View the post
          </Link>
        }
      />
    );
  }
  return <DraftEditor key={draft.data.id} draft={draft.data} />;
}

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

  const [title, setTitle] = useState(() => defaultTitle(draft));
  const [body, setBody] = useState(draft.body ?? "");
  const [visibility, setVisibility] = useState<Post["visibility"]>(draft.visibility);
  const [showVideo, setShowVideo] = useState(draft.show_video);
  const [showDemoVideo, setShowDemoVideo] = useState(draft.show_demo_video);
  const [coverMediaId, setCoverMediaId] = useState<string | null>(draft.cover_media_id);
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
    if (busy) return;
    try {
      const { id } = await publish.mutateAsync(edit);
      const copied = await copyText(postWebUrl(id));
      toast({
        title: copied ? "Published — link copied" : "Published",
        description: copied ? postWebUrl(id) : undefined,
        variant: "success",
      });
      void navigate(`/posts/${id}`, { replace: true });
    } catch (err) {
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
      await remove.mutateAsync(draft.id);
      toast({ title: "Draft deleted" });
      void navigate("/drafts", { replace: true });
    } catch (err) {
      toast({ title: "Couldn't delete", description: errorMessage(err), variant: "error" });
    }
  };

  useHotkey({ key: "Enter", mod: true }, () => void doPublish());

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void doPublish();
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <Link
          to="/drafts"
          className="inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-zinc-200"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Drafts
        </Link>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="danger"
            icon={<Trash2 className="size-3.5" aria-hidden />}
            onClick={() => void doDelete()}
            disabled={busy}
          >
            Delete draft
          </Button>
        </div>
      </div>

      <header className="flex flex-wrap items-center gap-3 text-sm text-zinc-400">
        {session ? <KindBadge kind={session.kind} /> : null}
        {session ? <span>{formatDurationHuman(session.active_ms)} active</span> : null}
        {session ? (
          <>
            <span aria-hidden>·</span>
            <span>started {formatDateTime(session.started_at)}</span>
          </>
        ) : null}
        <span aria-hidden>·</span>
        <span>{plural(problems.length, "problem")}</span>
      </header>

      <form onSubmit={onSubmit} className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="space-y-4">
          <Card className="space-y-4">
            <div>
              <Label htmlFor="draft-title">Title</Label>
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
              <Label htmlFor="draft-body">Body</Label>
              <Textarea
                id="draft-body"
                className="mt-1 min-h-40"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="What did you learn? What was the approach?"
                maxLength={5000}
              />
            </div>
            <div>
              <Label htmlFor="draft-visibility">Visibility</Label>
              <Select
                id="draft-visibility"
                className="mt-1"
                value={visibility}
                onChange={(e) => setVisibility(e.target.value as Post["visibility"])}
              >
                <option value="public">Followers and everyone (if your account is public)</option>
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
            <div className="flex items-center justify-between gap-3 pt-1">
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => void doSave()} disabled={busy}>
                  Save draft
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<Eye className="size-3.5" aria-hidden />}
                  onClick={() => setPreviewing(true)}
                >
                  Preview
                </Button>
              </div>
              <Button
                type="submit"
                variant="primary"
                icon={<Send className="size-4" aria-hidden />}
                loading={publish.isPending}
                disabled={busy}
                title="⌘/Ctrl + Enter"
              >
                Publish
              </Button>
            </div>
          </Card>

          <section className="space-y-3">
            <SectionTitle>Problems</SectionTitle>
            {problems.length === 0 ? (
              <p className="text-sm text-zinc-500">No problems were captured in this session.</p>
            ) : (
              problems.map((p) => <ProblemSection key={p.id} problem={p} />)
            )}
          </section>
        </div>

        <aside className="space-y-4">
          <DemoVideoPanel draft={draft} />
          <PostExtrasPanel draft={draft} />
          <PostMediaPanel
            postId={draft.id}
            userId={userId}
            coverMediaId={coverMediaId}
            onCoverChange={setCoverMediaId}
            disabled={busy}
          />
        </aside>
      </form>

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
