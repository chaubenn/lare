import { buttonClass, Card, Container, PageHeader } from "@lare/ui/primitives";
import Link from "next/link";
import { DesktopCapability } from "@/components/desktop-capability";
import { PendingButton } from "@/components/pending-button";
import { RefreshWorkspace } from "@/components/refresh-workspace";
import { TimeAgo } from "@/components/time-ago";
import { createClient } from "@/lib/supabase/server";
import { requireViewer } from "@/lib/viewer";
import { createDraft } from "./actions";
import { TrackedProblems } from "./tracked-problems";

export default async function DraftsPage() {
  const viewer = await requireViewer("/drafts");
  const supabase = await createClient();
  const [drafts, tracked] = await Promise.all([
    supabase
      .from("posts")
      .select("*, sessions(kind, session_problems(id, title))")
      .eq("user_id", viewer.id)
      .eq("status", "draft")
      .order("updated_at", { ascending: false }),
    supabase
      .from("session_problems")
      .select("*, submissions(id, accepted), sessions!inner(user_id, is_practice_inbox)")
      .eq("sessions.user_id", viewer.id)
      .eq("sessions.is_practice_inbox", true)
      .order("opened_at", { ascending: false }),
  ]);
  if (drafts.error) throw drafts.error;
  if (tracked.error) throw tracked.error;
  return (
    <Container width="page" className="space-y-5">
      <PageHeader
        title="Drafts"
        actions={
          <form action={createDraft}>
            <PendingButton className={buttonClass("primary", "sm")}>New video draft</PendingButton>
          </form>
        }
      />
      <p className="text-sm text-[var(--text-secondary)]">
        Your private workspace. Record a general video, summarize a session, or publish problems
        captured by the extension.
      </p>
      <RefreshWorkspace />
      {tracked.data.length > 0 && <TrackedProblems problems={tracked.data} />}
      <div className="space-y-3">
        {drafts.data.length === 0 ? (
          <Card className="p-6 text-sm text-[var(--text-secondary)]">
            No drafts yet. Create a video draft or finish a session in the extension.
          </Card>
        ) : (
          drafts.data.map((draft) => (
            <Link key={draft.id} href={`/drafts/${draft.id}`} className="block">
              <Card className="space-y-2 p-4 hover:bg-[var(--surface-raised)]">
                <h2 className="font-medium">{draft.title || "Untitled draft"}</h2>
                <p className="text-sm text-[var(--text-secondary)]">
                  {draft.sessions?.kind ?? "General video"} /{" "}
                  {draft.sessions?.session_problems.length ?? 0} problems / {draft.visibility}
                </p>
                <p className="truncate text-sm">
                  {draft.sessions?.session_problems.map((p) => p.title).join(", ") ||
                    draft.body ||
                    "Continue to media and details"}
                </p>
                <TimeAgo iso={draft.updated_at} className="text-xs text-[var(--text-tertiary)]" />
              </Card>
            </Link>
          ))
        )}
      </div>
      <DesktopCapability />
    </Container>
  );
}
