/** Shared state shape for `useActionState`-driven profile forms (onboarding, settings). */
export interface ProfileFormState {
  error: string | null;
  field: "handle" | "display_name" | "bio" | null;
  ok?: boolean;
}

export const PROFILE_FORM_IDLE: ProfileFormState = { error: null, field: null };

/** Postgres unique_violation, e.g. a taken `profiles.handle`. */
export function isUniqueViolation(error: { code?: string } | null | undefined): boolean {
  return error?.code === "23505";
}
