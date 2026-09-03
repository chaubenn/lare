"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { isUniqueViolation, type ProfileFormState } from "@/lib/forms";
import { HandleSchema } from "@/lib/parse";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/viewer";

const OnboardingSchema = z.object({
  handle: HandleSchema,
  display_name: z
    .string()
    .trim()
    .min(1, "Add a display name.")
    .max(60, "Keep it under 60 characters."),
  is_private: z.boolean(),
  next: z.string().optional(),
});

export async function completeOnboarding(
  _prev: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  const parsed = OnboardingSchema.safeParse({
    handle: formData.get("handle"),
    display_name: formData.get("display_name"),
    is_private: formData.get("is_private") === "on",
    next: formData.get("next") ?? undefined,
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path[0];
    return {
      error: issue?.message ?? "Check the form and try again.",
      field: field === "handle" || field === "display_name" ? field : null,
    };
  }

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims.sub;
  if (!userId) redirect("/login?next=%2Fonboarding");

  const { error } = await supabase
    .from("profiles")
    .update({
      handle: parsed.data.handle,
      display_name: parsed.data.display_name,
      is_private: parsed.data.is_private,
    })
    .eq("id", userId);

  if (error) {
    if (isUniqueViolation(error)) {
      return { error: "That handle is taken. Try another one.", field: "handle" };
    }
    return { error: error.message, field: null };
  }

  redirect(safeNextPath(parsed.data.next));
}
