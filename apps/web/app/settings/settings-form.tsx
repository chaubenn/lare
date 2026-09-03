"use client";

import type { Profile } from "@lare/supabase-types";
import { Check, LoaderCircle } from "lucide-react";
import { useActionState } from "react";
import { HandleField } from "@/components/handle-field";
import { PrivateToggle } from "@/components/private-toggle";
import { PROFILE_FORM_IDLE } from "@/lib/forms";
import { buttonPrimary, inputClass, labelClass } from "@/lib/styles";
import { updateProfile } from "./actions";

export function SettingsForm({ profile }: { profile: Profile }) {
  const [state, action, pending] = useActionState(updateProfile, PROFILE_FORM_IDLE);

  return (
    <form action={action} className="space-y-5">
      <HandleField
        defaultValue={profile.handle ?? ""}
        error={state.field === "handle" ? state.error : null}
      />

      <div className="space-y-1.5">
        <label htmlFor="display_name" className={labelClass}>
          Display name
        </label>
        <input
          id="display_name"
          name="display_name"
          defaultValue={profile.display_name ?? ""}
          required
          maxLength={60}
          autoComplete="name"
          className={inputClass}
        />
        {state.field === "display_name" && state.error && (
          <p className="text-xs text-rose-300">{state.error}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <label htmlFor="bio" className={labelClass}>
          Bio
        </label>
        <textarea
          id="bio"
          name="bio"
          defaultValue={profile.bio ?? ""}
          rows={3}
          maxLength={280}
          placeholder="What are you grinding right now?"
          className={`${inputClass} resize-y`}
        />
        {state.field === "bio" && state.error && (
          <p className="text-xs text-rose-300">{state.error}</p>
        )}
      </div>

      <PrivateToggle defaultChecked={profile.is_private} />

      {state.error && state.field === null && (
        <p role="alert" className="text-sm text-rose-300">
          {state.error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className={buttonPrimary}>
          {pending && <LoaderCircle className="size-4 animate-spin" />}
          Save changes
        </button>
        {state.ok && !pending && (
          <span className="inline-flex items-center gap-1 text-sm text-emerald-400">
            <Check className="size-4" />
            Saved
          </span>
        )}
      </div>
    </form>
  );
}
