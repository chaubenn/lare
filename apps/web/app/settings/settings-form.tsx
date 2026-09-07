"use client";

import type { Profile } from "@lare/supabase-types";
import { Button, FieldError, Input, Label, Textarea } from "@lare/ui/primitives";
import { Check } from "lucide-react";
import { useActionState } from "react";
import { FormToast } from "@/components/form-toast";
import { HandleField } from "@/components/handle-field";
import { PrivateToggle } from "@/components/private-toggle";
import { PROFILE_FORM_IDLE } from "@/lib/forms";
import { updateProfile } from "./actions";

export function SettingsForm({ profile }: { profile: Profile }) {
  const [state, action, pending] = useActionState(updateProfile, PROFILE_FORM_IDLE);

  return (
    <form action={action} className="space-y-5">
      <FormToast error={state.field === null ? state.error : null} />
      <HandleField
        defaultValue={profile.handle ?? ""}
        error={state.field === "handle" ? state.error : null}
      />

      <div className="space-y-1.5">
        <Label htmlFor="display_name">Display name</Label>
        <Input
          id="display_name"
          name="display_name"
          defaultValue={profile.display_name ?? ""}
          required
          maxLength={60}
          autoComplete="name"
        />
        <FieldError>{state.field === "display_name" ? state.error : null}</FieldError>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="bio">Bio</Label>
        <Textarea
          id="bio"
          name="bio"
          defaultValue={profile.bio ?? ""}
          rows={3}
          maxLength={280}
          placeholder="What are you grinding right now?"
        />
        <FieldError>{state.field === "bio" ? state.error : null}</FieldError>
      </div>

      <PrivateToggle defaultChecked={profile.is_private} />

      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary" loading={pending}>
          Save changes
        </Button>
        {state.ok && !pending && (
          <span className="inline-flex items-center gap-1 text-sm text-[var(--lare-status-run)]">
            <Check className="size-4" />
            Saved
          </span>
        )}
      </div>
    </form>
  );
}
