"use server";

import { revalidatePath } from "next/cache";
import { isUuid } from "@/lib/post-utils";
import { createClient } from "@/lib/supabase/server";

function revalidateFriends() {
  revalidatePath("/friends");
  // The nav badge lives in the root layout.
  revalidatePath("/", "layout");
}

export async function acceptFollowRequest(formData: FormData): Promise<void> {
  const follower = String(formData.get("follower") ?? "");
  if (!isUuid(follower)) return;
  const supabase = await createClient();
  const { error } = await supabase.rpc("accept_follow", { follower });
  if (error) throw new Error(`Couldn't accept request: ${error.message}`);
  revalidateFriends();
}

export async function declineFollowRequest(formData: FormData): Promise<void> {
  const follower = String(formData.get("follower") ?? "");
  if (!isUuid(follower)) return;
  const supabase = await createClient();
  const { error } = await supabase.rpc("decline_follow", { follower });
  if (error) throw new Error(`Couldn't decline request: ${error.message}`);
  revalidateFriends();
}
