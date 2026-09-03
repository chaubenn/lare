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
    <div className="mx-auto max-w-sm py-8">
      <h1 className="text-2xl font-semibold text-zinc-50">Sign in to Lare</h1>
      <p className="mt-1 text-sm text-zinc-400">
        Follow friends, share sessions and keep your LeetCode log in one place.
      </p>
      <LoginForm next={next} siteUrl={env.siteUrl} initialError={params.error ?? null} />
    </div>
  );
}
