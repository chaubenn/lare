import { Container, PageHeader } from "@lare/ui/primitives";
import { notFound } from "next/navigation";
import { ProblemSection } from "@/components/problem-section";
import { isUuid } from "@/lib/post-utils";
import { createClient } from "@/lib/supabase/server";
import { requireViewer } from "@/lib/viewer";
import { DraftStepper } from "./stepper";

export default async function DraftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await requireViewer(`/drafts/${id}`);
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  const { data: post, error } = await supabase
    .from("posts")
    .select("*, sessions(*, session_problems(*, submissions(*)))")
    .eq("id", id)
    .eq("user_id", viewer.id)
    .eq("status", "draft")
    .maybeSingle();
  if (error) throw error;
  if (!post || (post.sessions && post.sessions.user_id !== viewer.id)) notFound();
  const [videos, review] = await Promise.all([
    supabase
      .from("videos")
      .select("*")
      .eq("user_id", viewer.id)
      .order("created_at", { ascending: false }),
    post.session_id
      ? supabase
          .from("interview_reviews")
          .select("id")
          .eq("session_id", post.session_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (videos.error) throw videos.error;
  if (review.error) throw review.error;
  const problems = [...(post.sessions?.session_problems ?? [])].sort((a, b) =>
    a.opened_at.localeCompare(b.opened_at),
  );
  const ungraded = post.sessions?.graded === false;
  return (
    <Container width="page" className="space-y-5">
      <PageHeader title="Edit draft" />
      <DraftStepper
        key={post.id}
        post={post}
        videos={videos.data}
        problemCount={problems.length}
        interview={post.sessions?.kind === "interview"}
        hasReview={!!review.data && !ungraded}
        problems={
          <div className="space-y-3">
            {problems.map((problem, index) => (
              <ProblemSection key={problem.id} problem={problem} index={index} />
            ))}
          </div>
        }
      />
    </Container>
  );
}
