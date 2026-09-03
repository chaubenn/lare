import { WS_PORT } from "@lare/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { useToast } from "@/components/toast/ToastProvider";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, PageHeader, SectionTitle } from "@/components/ui/Card";
import { FieldError, Input, Label, Textarea, Toggle } from "@/components/ui/Field";
import { profileQueryKey, useAuth, useUser } from "@/features/auth/AuthProvider";
import { HANDLE_RE } from "@/features/auth/OnboardingPage";
import { useExtensionStatus } from "@/features/shell/useExtensionStatus";
import { copyText } from "@/lib/clipboard";
import { errorMessage, supabase } from "@/lib/supabase";
import { appVersion } from "@/lib/tauri";

const EXTENSION_ID = "koplffaeeahehnfikinmldhhmmldghhl";

export function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" />
      <div className="space-y-4">
        <ProfileForm />
        <ExtensionPanel />
        <AccountPanel />
      </div>
    </>
  );
}

function ProfileForm() {
  const { userId, profile } = useUser();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [displayName, setDisplayName] = useState(profile?.display_name ?? "");
  const [bio, setBio] = useState(profile?.bio ?? "");
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
    save.mutate();
  };

  return (
    <Card>
      <SectionTitle>Profile</SectionTitle>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="st-name">Display name</Label>
            <Input
              id="st-name"
              className="mt-1"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={60}
            />
          </div>
          <div>
            <Label htmlFor="st-handle" hint="a–z, 0–9, _">
              Handle
            </Label>
            <div className="mt-1 flex items-center gap-1">
              <span className="text-zinc-500">@</span>
              <Input
                id="st-handle"
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
          <Label htmlFor="st-bio">Bio</Label>
          <Textarea
            id="st-bio"
            className="mt-1"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            maxLength={280}
            placeholder="A line about you"
          />
        </div>
        <Toggle
          id="st-private"
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

function ExtensionPanel() {
  const { connected, port } = useExtensionStatus();
  const { toast } = useToast();
  return (
    <Card>
      <SectionTitle
        action={
          connected ? <Badge tone="emerald">connected</Badge> : <Badge>not connected</Badge>
        }
      >
        Extension
      </SectionTitle>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-zinc-500">Chrome extension id</dt>
          <dd className="mt-1 flex items-center gap-2">
            <code className="select-text font-mono text-xs text-zinc-200">{EXTENSION_ID}</code>
            <button
              type="button"
              className="text-xs text-zinc-500 hover:text-zinc-300"
              onClick={() =>
                void copyText(EXTENSION_ID).then((ok) =>
                  toast(ok ? { title: "Copied" } : { title: "Couldn't copy", variant: "error" }),
                )
              }
            >
              copy
            </button>
          </dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500">Local server</dt>
          <dd className="mt-1 font-mono text-xs text-zinc-200">
            ws://127.0.0.1:{port || WS_PORT}
          </dd>
        </div>
      </dl>
      <p className="mt-3 text-xs text-zinc-500">
        The extension connects to this app over localhost when you start a session. Reload the
        LeetCode tab if it shows "not connected".
      </p>
    </Card>
  );
}

function AccountPanel() {
  const { signOut } = useAuth();
  const { session } = useUser();
  const { toast } = useToast();
  const [version, setVersion] = useState<string>("…");
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    let active = true;
    appVersion()
      .then((v) => {
        if (active) setVersion(v);
      })
      .catch(() => {
        if (active) setVersion("unknown");
      });
    return () => {
      active = false;
    };
  }, []);

  const doSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
    } catch (err) {
      toast({ title: "Couldn't sign out", description: errorMessage(err), variant: "error" });
      setSigningOut(false);
    }
  };

  return (
    <Card>
      <SectionTitle>Account</SectionTitle>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm">
          <div className="text-zinc-200">{session.user.email ?? session.user.id}</div>
          <div className="mt-0.5 text-xs text-zinc-500">Lare desktop v{version}</div>
        </div>
        <Button
          variant="danger"
          size="sm"
          icon={<LogOut className="size-3.5" aria-hidden />}
          onClick={() => void doSignOut()}
          loading={signingOut}
        >
          Sign out
        </Button>
      </div>
    </Card>
  );
}
