"use server";

import { parseGoalForm } from "@lare/shared";
import { revalidatePath } from "next/cache";
import type { GoalFormState } from "@/lib/forms";
import { createClient } from "@/lib/supabase/server";
import { getViewer } from "@/lib/viewer";

export async function saveGoal(_prev: GoalFormState, formData: FormData): Promise<GoalFormState> {
  const viewer = await getViewer();
  if (!viewer) return { error: "Sign in to set a goal." };
  const goal = parseGoalForm({
    period: formData.get("period"),
    target: formData.get("target"),
    min_difficulty: formData.get("min_difficulty") ?? "",
  });
  if (!goal) return { error: "Pick a daily or weekly goal of 1 to 50 problems." };
  const supabase = await createClient();
  const { error } = await supabase.from("practice_goals").upsert({ user_id: viewer.id, ...goal });
  if (error) return { error: `Couldn't save your goal: ${error.message}` };
  revalidatePath("/");
  return { error: null, ok: true };
}

export async function clearGoal(_formData: FormData): Promise<void> {
  const viewer = await getViewer();
  if (!viewer) return;
  const supabase = await createClient();
  const { error } = await supabase.from("practice_goals").delete().eq("user_id", viewer.id);
  if (error) throw new Error(`Couldn't remove your goal: ${error.message}`);
  revalidatePath("/");
}
