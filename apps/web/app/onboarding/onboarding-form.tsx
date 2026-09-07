"use client";

import { Button, FieldError, Input, Label } from "@lare/ui/primitives";
import { useActionState } from "react";
import { FormToast } from "@/components/form-toast";
import { HandleField } from "@/components/handle-field";
import { PrivateToggle } from "@/components/private-toggle";
import { PROFILE_FORM_IDLE } from "@/lib/forms";
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
      <FormToast error={state.field === null ? state.error : null} />

      <HandleField error={state.field === "handle" ? state.error : null} />

      <div className="space-y-1.5">
        <Label htmlFor="display_name">Display name</Label>
        <Input
          id="display_name"
          name="display_name"
          defaultValue={defaultDisplayName}
          required
          maxLength={60}
          autoComplete="name"
        />
        <FieldError>{state.field === "display_name" ? state.error : null}</FieldError>
      </div>

      <PrivateToggle defaultChecked={defaultPrivate} />

      <Button type="submit" variant="primary" loading={pending} className="w-full">
        Continue
      </Button>
    </form>
  );
}
