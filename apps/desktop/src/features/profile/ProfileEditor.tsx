import {
  AVATAR_BUCKET,
  avatarPath,
  HANDLE_RE,
  rejectAvatarInput,
  resizeAvatarImage,
  withCacheBust,
} from "@lare/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react";
import { type FormEvent, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/Card";
import { FieldError, Input, Label, Textarea, Toggle } from "@/components/ui/Field";
import { profileQueryKey, useUser } from "@/features/auth/AuthProvider";
import { useNotify } from "@/features/notifications/notices";
import { errorMessage, supabase } from "@/lib/supabase";

/** `/profile/edit`: photo, name, handle, bio, website, privacy. Saving returns to the profile. */
export function ProfileEditor() {
  const { userId, profile, session } = useUser();
  const queryClient = useQueryClient();
  const { notify } = useNotify();
  const [displayName, setDisplayName] = useState(profile?.display_name ?? "");
  const [bio, setBio] = useState(profile?.bio ?? "");
  const [website, setWebsite] = useState(profile?.website ?? "");
  const [handle, setHandle] = useState(profile?.handle ?? "");
  const [isPrivate, setIsPrivate] = useState(profile?.is_private ?? false);
  const [error, setError] = useState<string | null>(null);

  const navigate = useNavigate();
  const dirty =
    displayName !== (profile?.display_name ?? "") ||
    bio !== (profile?.bio ?? "") ||
    website !== (profile?.website ?? "") ||
    handle !== (profile?.handle ?? "") ||
    isPrivate !== (profile?.is_private ?? false);

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
      notify({ title: "Profile saved", variant: "success" });
      navigate("/profile");
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
    <div className="mx-auto max-w-2xl">
      <Link
        to="/profile"
        className="mb-3 inline-flex items-center gap-1 rounded-[var(--lare-r-1)] text-sm text-[var(--text-secondary)] hover:text-[var(--text)] focus-visible:outline-2 focus-visible:outline-[var(--focus)]"
      >
        <ChevronLeft className="size-4" aria-hidden />
        Profile
      </Link>
      <PageHeader title="Edit profile" subtitle={session.user.email} />

      <form onSubmit={onSubmit} className="space-y-4">
        <section className={PANEL}>
          <h2 className={PANEL_HEADING}>Photo</h2>
          <AvatarUploader />
        </section>

        <section className={PANEL}>
          <h2 className={PANEL_HEADING}>Details</h2>
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="pf-name">Display name</Label>
                <Input
                  id="pf-name"
                  className={FIELD}
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  maxLength={60}
                />
              </div>
              <div>
                <Label htmlFor="pf-handle" hint="a–z, 0–9, _">
                  Handle
                </Label>
                <div className="relative">
                  <span
                    className="pointer-events-none absolute top-1/2 left-3 mt-0.5 -translate-y-1/2 text-sm text-[var(--text-tertiary)]"
                    aria-hidden
                  >
                    @
                  </span>
                  <Input
                    id="pf-handle"
                    className={`${FIELD} pl-7!`}
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
              <Label htmlFor="pf-bio" hint={`${bio.length}/280`}>
                Bio
              </Label>
              <Textarea
                id="pf-bio"
                className={FIELD}
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
                className={FIELD}
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                maxLength={200}
                spellCheck={false}
                autoComplete="url"
                placeholder="yourdomain.com"
              />
            </div>
          </div>
        </section>

        <section className={PANEL}>
          <h2 className={PANEL_HEADING}>Privacy</h2>
          <Toggle
            id="pf-private"
            checked={isPrivate}
            onChange={setIsPrivate}
            label="Private account"
            description="Only accepted followers see your posts. Follow requests need your approval."
          />
        </section>

        <FieldError>{error}</FieldError>
        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => navigate("/profile")}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={save.isPending} disabled={!dirty}>
            Save changes
          </Button>
        </div>
      </form>
    </div>
  );
}

/** Raised panels on the ink ground, with sunken fields inside, so every group reads at a glance. */
const PANEL =
  "rounded-[var(--lare-r-4)] border border-[var(--border)] bg-[var(--surface-raised)] p-5";
const PANEL_HEADING = "mb-4 text-sm font-semibold text-[var(--text)]";
const FIELD = "mt-1 bg-[var(--surface)]!";

function AvatarUploader() {
  const { userId, profile } = useUser();
  const queryClient = useQueryClient();
  const { notify } = useNotify();
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
      notify({ title: "Profile picture updated", variant: "success" });
    },
    onError: (err) => notify({ title: errorMessage(err), variant: "error" }),
  });

  return (
    <div className="flex items-center gap-4">
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
