import { formatDurationHuman } from "@lare/shared";
import { Card, Container, PageHeader } from "@lare/ui/primitives";
import Link from "next/link";
import { DesktopCapability } from "@/components/desktop-capability";
import { RefreshWorkspace } from "@/components/refresh-workspace";
import { TimeAgo } from "@/components/time-ago";
import { createClient } from "@/lib/supabase/server";
import { requireViewer } from "@/lib/viewer";

export default async function SessionsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const viewer = await requireViewer("/sessions");
  const raw = Number((await searchParams).page ?? 1);
  const page = Number.isSafeInteger(raw) && raw > 0 ? Math.min(raw, 10000) : 1;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sessions")
    .select("*, session_problems(id, title, difficulty), posts(id, slug, status, title)")
    .eq("user_id", viewer.id)
    .order("started_at", { ascending: false })
    .order("id", { ascending: false })
    .range((page - 1) * 30, page * 30);
  if (error) throw error;
  return (
    <Container width="page" className="space-y-5">
      <PageHeader
        title="Sessions"
        actions={
          <Link href="/drafts" className="text-sm underline">
            Drafts
          </Link>
        }
      />
      <p className="text-sm text-[var(--text-secondary)]">
        Only you can see this history: problem attempts, submissions, code edits and any locally
        generated transcript and review.
      </p>
      <DesktopCapability />
      <RefreshWorkspace />
      <div className="space-y-3">
        {!data.length && (
          <Card className="p-6 text-sm">
            No sessions on this page. Practice on LeetCode with the extension to capture your first
            session.
          </Card>
        )}
        {data.slice(0, 30).map((session) => (
          <Link key={session.id} href={`/sessions/${session.id}`} className="block">
            <Card className="space-y-2 p-4 hover:bg-[var(--surface-raised)]">
              <h2 className="font-medium">
                {session.posts?.title ||
                  (session.is_practice_inbox
                    ? "Tracked practice inbox"
                    : `${session.kind === "interview" ? "Mock interview" : "Practice session"}`)}
              </h2>
              <p className="text-sm text-[var(--text-secondary)]">
                {session.status} / {formatDurationHuman(session.active_ms)} active /{" "}
                {session.session_problems.length} problems
                {session.kind === "interview" && "graded" in session && session.graded === false
                  ? " / Ungraded (video only)"
                  : ""}
              </p>
              <p className="truncate text-sm">
                {session.session_problems.map((p) => p.title).join(", ") ||
                  "Waiting for captured problems"}
              </p>
              <TimeAgo iso={session.started_at} className="text-xs text-[var(--text-tertiary)]" />
            </Card>
          </Link>
        ))}
      </div>
      <nav aria-label="Session pages" className="flex gap-4 text-sm">
        {page > 1 && <Link href={`/sessions?page=${page - 1}`}>Previous</Link>}
        {data.length > 30 && <Link href={`/sessions?page=${page + 1}`}>Next</Link>}
      </nav>
    </Container>
  );
}
