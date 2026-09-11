import {
  AVATAR_BUCKET,
  avatarPath,
  HANDLE_RE,
  rejectAvatarInput,
  resizeAvatarImage,
  withCacheBust,
} from "@lare/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useRef, useState } from "react";
import { useToast } from "@/components/toast/ToastProvider";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Card, SectionTitle } from "@/components/ui/Card";
import { FieldError, Input, Label, Textarea, Toggle } from "@/components/ui/Field";
import { profileQueryKey, useUser } from "@/features/auth/AuthProvider";
import { errorMessage, supabase } from "@/lib/supabase";

/** The editable half of the profile tab: photo, name, handle, bio, website, privacy. */
export function ProfileEditor() {
  const { userId, profile } = useUser();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [displayName, setDisplayName] = useState(profile?.display_name ?? "");
  const [bio, setBio] = useState(profile?.bio ?? "");
  const [website, setWebsite] = useState(profile?.website ?? "");
  const [handle, setHandle] = useState(profile?.handle ?? "");
  const [isPrivate, setIsPrivate] = useState(profile?.is_private ?? false);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      const { error: updateError } = await supabase
        .from("profiles")
        .update({
          display_name: displayName.trim() || null,
          bio: bio.trim() || null,
          website: website.trim() || null,
          handle,
          is_private: isPrivate,
        })
        .eq("id", userId);
      if (updateError) {
        if (updateError.code === "23505") throw new Error("That handle is already taken.");
        throw updateError;
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: profileQueryKey(userId) });
      void queryClient.invalidateQueries({ queryKey: ["profile-stats"] });
      toast({ title: "Profile saved", variant: "success" });
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!HANDLE_RE.test(handle)) {
      setError("Handles are 3–20 characters: lowercase letters, digits and underscores.");
      return;
    }
    if (website.trim().length > 200) {
      setError("Keep the website link under 200 characters.");
      return;
    }
    save.mutate();
  };

  return (
    <Card>
      <SectionTitle>Edit profile</SectionTitle>
      <AvatarUploader />
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="pf-name">Display name</Label>
            <Input
              id="pf-name"
              className="mt-1"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={60}
            />
          </div>
          <div>
            <Label htmlFor="pf-handle" hint="a–z, 0–9, _">
              Handle
            </Label>
            <div className="mt-1 flex items-center gap-1">
              <span className="text-zinc-500">@</span>
              <Input
                id="pf-handle"
                value={handle}
                onChange={(e) => setHandle(e.target.value.toLowerCase())}
                maxLength={20}
                spellCheck={false}
                autoComplete="off"
              />
            </div>
          </div>
        </div>
        <div>
          <Label htmlFor="pf-bio">Bio</Label>
          <Textarea
            id="pf-bio"
            className="mt-1"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            maxLength={280}
            placeholder="A line about you"
          />
        </div>
        <div>
          <Label htmlFor="pf-website" hint="optional">
            Website
          </Label>
          <Input
            id="pf-website"
            className="mt-1"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            maxLength={200}
            spellCheck={false}
            autoComplete="url"
            placeholder="yourdomain.com"
          />
        </div>
        <Toggle
          id="pf-private"
          checked={isPrivate}
          onChange={setIsPrivate}
          label="Private account"
          description="Only accepted followers see your posts. Follow requests need your approval."
        />
        <FieldError>{error}</FieldError>
        <div className="flex justify-end">
          <Button type="submit" variant="primary" loading={save.isPending}>
            Save changes
          </Button>
        </div>
      </form>
    </Card>
  );
}

function AvatarUploader() {
  const { userId, profile } = useUser();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const reason = rejectAvatarInput(file);
      if (reason) throw new Error(reason);

      const blob = await resizeAvatarImage(file);
      const path = avatarPath(userId);
      const { error: uploadError } = await supabase.storage
        .from(AVATAR_BUCKET)
        .upload(path, blob, { contentType: "image/jpeg", upsert: true });
      if (uploadError) throw uploadError;

      const { data } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path);
      const avatarUrl = withCacheBust(data.publicUrl);
      const { error: updateError } = await supabase
        .from("profiles")
        .update({ avatar_url: avatarUrl })
        .eq("id", userId);
      if (updateError) throw updateError;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: profileQueryKey(userId) });
      toast({ title: "Profile picture updated", variant: "success" });
    },
    onError: (err) => toast({ title: errorMessage(err), variant: "error" }),
  });

  return (
    <div className="mb-4 flex items-center gap-4">
      <Avatar url={profile?.avatar_url} name={profile?.display_name} size={64} />
      <div>
        <Button
          type="button"
          variant="secondary"
          loading={upload.isPending}
          onClick={() => inputRef.current?.click()}
        >
          Change photo
        </Button>
        <p className="mt-1 text-xs text-zinc-500">JPEG, PNG, WebP or GIF, up to 20 MB.</p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) upload.mutate(file);
        }}
      />
    </div>
  );
}
