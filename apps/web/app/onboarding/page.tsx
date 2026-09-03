import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getViewer, safeNextPath } from "@/lib/viewer";
import { OnboardingForm } from "./onboarding-form";

export const metadata: Metadata = { title: "Choose a handle" };

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const next = safeNextPath(params.next);
  const viewer = await getViewer();
  if (!viewer) redirect(`/login?next=${encodeURIComponent(`/onboarding?next=${next}`)}`);
  if (viewer.profile?.handle) redirect(next);

  return (
    <div className="mx-auto max-w-sm py-8">
      <h1 className="text-2xl font-semibold text-zinc-50">Welcome to Lare</h1>
      <p className="mt-1 text-sm text-zinc-400">
        Pick a handle so friends can find you. You can change it later in Settings.
      </p>
      <OnboardingForm
        next={next}
        defaultDisplayName={viewer.profile?.display_name ?? ""}
        defaultPrivate={viewer.profile?.is_private ?? false}
      />
    </div>
  );
}
