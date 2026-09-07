import { Wordmark } from "@lare/ui/brand";
import { Container } from "@lare/ui/primitives";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { env } from "@/lib/env";
import { getViewer, safeNextPath } from "@/lib/viewer";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams;
  const next = safeNextPath(params.next);
  const viewer = await getViewer();
  if (viewer) redirect(viewer.profile?.handle ? next : "/onboarding");

  return (
    <Container width="prose" className="py-8">
      <Wordmark className="text-xl text-[var(--text)]" markClassName="size-6" />
      <h1 className="lare-title mt-6 text-[var(--text)]">Sign in to Lare</h1>
      <p className="mt-1 text-sm text-[var(--text-secondary)]">
        Follow friends, share sessions and keep your LeetCode log in one place.
      </p>
      <LoginForm next={next} siteUrl={env.siteUrl} initialError={params.error ?? null} />
    </Container>
  );
}
