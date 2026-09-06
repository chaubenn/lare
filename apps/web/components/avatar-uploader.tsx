"use client";

import {
  AVATAR_BUCKET,
  avatarPath,
  rejectAvatarInput,
  resizeAvatarImage,
  withCacheBust,
} from "@lare/shared";
import { LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Avatar } from "@/components/avatar";
import { buttonSecondary } from "@/lib/styles";
import { createClient } from "@/lib/supabase/client";

export function AvatarUploader({
  userId,
  avatarUrl,
  name,
}: {
  userId: string;
  avatarUrl: string | null;
  name: string | null;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onFile(file: File) {
    setError(null);
    const reason = rejectAvatarInput(file);
    if (reason) {
      setError(reason);
      return;
    }
    startTransition(async () => {
      const supabase = createClient();
      const blob = await resizeAvatarImage(file);
      const path = avatarPath(userId);
      const { error: uploadError } = await supabase.storage
        .from(AVATAR_BUCKET)
        .upload(path, blob, { contentType: "image/jpeg", upsert: true });
      if (uploadError) {
        setError(uploadError.message);
        return;
      }
      const { data } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path);
      const { error: updateError } = await supabase
        .from("profiles")
        .update({ avatar_url: withCacheBust(data.publicUrl) })
        .eq("id", userId);
      if (updateError) {
        setError(updateError.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="mb-5 flex items-center gap-3">
      <Avatar src={avatarUrl} name={name} size="md" />
      <div className="text-sm">
        <button
          type="button"
          disabled={pending}
          onClick={() => inputRef.current?.click()}
          className={`${buttonSecondary} px-3 py-1.5 text-xs`}
        >
          {pending && <LoaderCircle className="size-3.5 animate-spin" />}
          Change photo
        </button>
        <p className={`mt-1 text-xs ${error ? "text-rose-300" : "text-zinc-500"}`}>
          {error ?? "JPEG, PNG, WebP or GIF, up to 20 MB."}
        </p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) onFile(file);
        }}
      />
    </div>
  );
}
