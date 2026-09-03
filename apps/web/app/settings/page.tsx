import { LogOut } from "lucide-react";
import type { Metadata } from "next";
import { signOut } from "@/app/auth/actions";
import { Avatar } from "@/components/avatar";
import { PendingButton } from "@/components/pending-button";
import { buttonSecondary, cardClass } from "@/lib/styles";
import { requireViewer } from "@/lib/viewer";
import { SettingsForm } from "./settings-form";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const viewer = await requireViewer("/settings");

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-zinc-50">Settings</h1>
        <p className="mt-1 text-sm text-zinc-400">How you appear to other people on Lare.</p>
      </div>

      <section className={`${cardClass} p-5`}>
        <div className="mb-5 flex items-center gap-3">
          <Avatar
            src={viewer.profile.avatar_url}
            name={viewer.profile.display_name ?? viewer.profile.handle}
            size="md"
          />
          <div className="text-sm">
            <p className="font-medium text-zinc-100">{viewer.email ?? "Signed in"}</p>
            <p className="text-xs text-zinc-500">Avatar comes from your sign-in provider.</p>
          </div>
        </div>
        <SettingsForm profile={viewer.profile} />
      </section>

      <section className={`${cardClass} flex flex-wrap items-center justify-between gap-3 p-5`}>
        <div>
          <h2 className="text-sm font-semibold text-zinc-100">Sign out</h2>
          <p className="text-xs text-zinc-500">You'll need to sign in again on this device.</p>
        </div>
        <form action={signOut}>
          <PendingButton className={buttonSecondary}>
            <LogOut className="size-4" />
            Sign out
          </PendingButton>
        </form>
      </section>
    </div>
  );
}
