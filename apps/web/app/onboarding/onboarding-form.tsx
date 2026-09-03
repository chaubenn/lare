"use client";

import { LoaderCircle } from "lucide-react";
import { useActionState } from "react";
import { HandleField } from "@/components/handle-field";
import { PrivateToggle } from "@/components/private-toggle";
import { PROFILE_FORM_IDLE } from "@/lib/forms";
import { buttonPrimary, inputClass, labelClass } from "@/lib/styles";
import { completeOnboarding } from "./actions";

export function OnboardingForm({
  next,
  defaultDisplayName,
  defaultPrivate,
}: {
  next: string;
  defaultDisplayName: string;
  defaultPrivate: boolean;
}) {
  const [state, action, pending] = useActionState(completeOnboarding, PROFILE_FORM_IDLE);

  return (
    <form action={action} className="mt-8 space-y-5">
      <input type="hidden" name="next" value={next} />

      <HandleField error={state.field === "handle" ? state.error : null} />

      <div className="space-y-1.5">
        <label htmlFor="display_name" className={labelClass}>
          Display name
        </label>
        <input
          id="display_name"
          name="display_name"
          defaultValue={defaultDisplayName}
          required
          maxLength={60}
          autoComplete="name"
          className={inputClass}
        />
        {state.field === "display_name" && state.error && (
          <p className="text-xs text-rose-300">{state.error}</p>
        )}
      </div>

      <PrivateToggle defaultChecked={defaultPrivate} />

      {state.error && state.field === null && (
        <p role="alert" className="text-sm text-rose-300">
          {state.error}
        </p>
      )}

      <button type="submit" disabled={pending} className={`${buttonPrimary} w-full`}>
        {pending && <LoaderCircle className="size-4 animate-spin" />}
        Continue
      </button>
    </form>
  );
}
