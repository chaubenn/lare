import type { Profile } from "@lare/supabase-types";
import type { Session } from "@supabase/supabase-js";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { useToast } from "@/components/toast/ToastProvider";
import { env } from "@/lib/env";
import { errorMessage, supabase } from "@/lib/supabase";
import { inTauri, setCurrentUser, useTauriEvent } from "@/lib/tauri";

export const profileQueryKey = (userId: string) => ["profile", userId] as const;

export async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

interface AuthContextValue {
  /** `undefined` while the persisted session is being restored. */
  session: Session | null | undefined;
  userId: string | null;
  profile: Profile | null | undefined;
  profileLoading: boolean;
  profileError: unknown;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

/** Like useAuth() but guarantees a signed-in user (only render below RequireAuth). */
export function useUser(): {
  userId: string;
  session: Session;
  profile: Profile | null | undefined;
} {
  const { session, profile } = useAuth();
  if (!session) throw new Error("useUser() rendered without a session");
  return { userId: session.user.id, session, profile };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Restore the persisted session and follow auth changes.
  useEffect(() => {
    let active = true;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (active) setSession(data.session);
      })
      .catch(() => {
        if (active) setSession(null);
      });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, next) => {
      // Do not call other supabase methods synchronously in here (see supabase-js docs).
      setSession(next);
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  // Mirror the signed-in user into the Rust side (hello.ack.userId, /health).
  const userId = session?.user.id ?? null;
  useEffect(() => {
    if (session === undefined) return;
    setCurrentUser(userId).catch((err: unknown) => console.error("set_current_user failed", err));
    if (inTauri)
      void invoke("configure_pcm", {
        auth: session
          ? {
              userId: session.user.id,
              token: session.access_token,
              url: env.VITE_SUPABASE_URL,
              key: env.VITE_SUPABASE_PUBLISHABLE_KEY,
            }
          : null,
      }).catch((err: unknown) => console.error("Local grading configuration failed", err));
  }, [session, userId]);

  useTauriEvent("ext:message", (raw) => {
    const message = raw as { type?: string; sessionId?: string; message?: string };
    if (message.type === "review.error")
      toast({ title: "AI review failed", description: message.message, variant: "error" });
    if (["transcript.partial", "pcm.complete", "review.complete"].includes(message.type ?? "")) {
      void queryClient.invalidateQueries({ queryKey: ["session", message.sessionId] });
      void queryClient.invalidateQueries({ queryKey: ["interview-review", message.sessionId] });
    }
  });

  // OAuth loopback: the Rust server received ?code=... on 127.0.0.1:47831/auth/callback.
  useTauriEvent("auth:callback", ({ code }) => {
    supabase.auth
      .exchangeCodeForSession(code)
      .then(({ error }) => {
        if (error) toast({ title: "Sign-in failed", description: error.message, variant: "error" });
      })
      .catch((err: unknown) =>
        toast({ title: "Sign-in failed", description: errorMessage(err), variant: "error" }),
      );
  });
  useTauriEvent("auth:error", ({ error, description }) => {
    toast({ title: "Sign-in failed", description: description ?? error, variant: "error" });
  });

  const profileQuery = useQuery({
    queryKey: profileQueryKey(userId ?? "anonymous"),
    queryFn: () => fetchProfile(userId ?? ""),
    enabled: userId !== null,
    staleTime: 60_000,
  });

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      userId,
      profile: userId ? profileQuery.data : null,
      profileLoading: userId !== null && profileQuery.isPending,
      profileError: profileQuery.error,
      signOut: async () => {
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
        await setCurrentUser(null);
        queryClient.clear();
      },
    }),
    [session, userId, profileQuery.data, profileQuery.isPending, profileQuery.error, queryClient],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
