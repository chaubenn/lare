import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { useToast } from "@/components/toast/ToastProvider";
import { Button } from "@/components/ui/Button";
import { FieldError, Input, Label, Toggle } from "@/components/ui/Field";
import { errorMessage, supabase } from "@/lib/supabase";
import { profileQueryKey, useAuth, useUser } from "./AuthProvider";

export const HANDLE_RE = /^[a-z0-9_]{3,20}$/;

export function OnboardingPage() {
  const { userId, session } = useUser();
  const { signOut } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const suggested = (session.user.user_metadata as Record<string, unknown>)?.user_name;
  const suggestedName =
    (session.user.user_metadata as Record<string, unknown>)?.full_name ??
    (session.user.user_metadata as Record<string, unknown>)?.name;

  const [handle, setHandle] = useState(
    typeof suggested === "string" ? suggested.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 20) : "",
  );
  const [displayName, setDisplayName] = useState(typeof suggestedName === "string" ? suggestedName : "");
  const [isPrivate, setIsPrivate] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      const { error: updateError } = await supabase
        .from("profiles")
        .update({
          handle,
          display_name: displayName.trim() || null,
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
      toast({ title: "Welcome to Lare", variant: "success" });
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!HANDLE_RE.test(handle)) {
      setError("Handles are 3–20 characters: lowercase letters, digits and underscores.");
      return;
    }
    save.mutate();
  };

  return (
    <div className="flex h-full items-center justify-center p-8">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4">
        <div>
          <h1 className="text-xl font-semibold">Pick a handle</h1>
          <p className="mt-1 text-sm text-zinc-400">
            This is how people find and follow you. You can change the rest later in Settings.
          </p>
        </div>
        <div>
          <Label htmlFor="ob-handle" hint="a–z, 0–9, _">
            Handle
          </Label>
          <div className="mt-1 flex items-center gap-1">
            <span className="text-zinc-500">@</span>
            <Input
              id="ob-handle"
              value={handle}
              onChange={(e) => setHandle(e.target.value.toLowerCase())}
              placeholder="two_sum_enjoyer"
              autoComplete="off"
              spellCheck={false}
              maxLength={20}
            />
          </div>
        </div>
        <div>
          <Label htmlFor="ob-name">Display name</Label>
          <Input
            id="ob-name"
            className="mt-1"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Your name"
            maxLength={60}
          />
        </div>
        <Toggle
          id="ob-private"
          checked={isPrivate}
          onChange={setIsPrivate}
          label="Private account"
          description="Only accepted followers see your posts. Follow requests need your approval."
        />
        <FieldError>{error}</FieldError>
        <div className="flex items-center justify-between pt-2">
          <button
            type="button"
            className="text-xs text-zinc-500 hover:text-zinc-300"
            onClick={() => void signOut()}
          >
            Sign out
          </button>
          <Button type="submit" variant="primary" loading={save.isPending}>
            Continue
          </Button>
        </div>
      </form>
    </div>
  );
}
