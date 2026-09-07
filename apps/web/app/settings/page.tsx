import { Card, Container, PageHeader } from "@lare/ui/primitives";
import { LogOut } from "lucide-react";
import type { Metadata } from "next";
import { signOut } from "@/app/auth/actions";
import { AvatarUploader } from "@/components/avatar-uploader";
import { PendingButton } from "@/components/pending-button";
import { requireViewer } from "@/lib/viewer";
import { SettingsForm } from "./settings-form";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const viewer = await requireViewer("/settings");

  return (
    <Container width="prose" className="space-y-6">
      <PageHeader title="Settings" subtitle="How you appear to other people on Lare." />

      <Card className="p-5">
        <AvatarUploader
          userId={viewer.profile.id}
          avatarUrl={viewer.profile.avatar_url}
          name={viewer.profile.display_name ?? viewer.profile.handle}
        />
        <SettingsForm profile={viewer.profile} />
      </Card>

      <Card className="flex flex-wrap items-center justify-between gap-3 p-5">
        <div>
          <h2 className="text-sm font-semibold text-[var(--text)]">
            {viewer.email ?? "Signed in"}
          </h2>
          <p className="text-xs text-[var(--text-tertiary)]">
            You'll need to sign in again on this device.
          </p>
        </div>
        <form action={signOut}>
          <PendingButton>
            <LogOut className="size-4" />
            Sign out
          </PendingButton>
        </form>
      </Card>
    </Container>
  );
}
