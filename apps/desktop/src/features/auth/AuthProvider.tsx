import type { Profile } from "@lare/supabase-types";
import type { Session } from "@supabase/supabase-js";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNotify } from "@/features/notifications/notices";
import { errorMessage, supabase } from "@/lib/supabase";
import { setCurrentUser, useTauriEvent } from "@/lib/tauri";
import { forgetExtensionPairing, pairExtension, unpairExtension } from "./extensionPairing";

/** How soon to try publishing the pairing secret again after it failed (offline, say). */
const PAIRING_RETRY_MS = 60_000;

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
  /** Try loading the profile again after it failed (offline at launch, say). */
  retryProfile: () => void;
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
  const { notify } = useNotify();
  // Whose data the query cache currently holds; `undefined` until the session is restored.
  const cacheOwner = useRef<string | null | undefined>(undefined);

  // Restore the persisted session and follow auth changes.
  useEffect(() => {
    let active = true;
    // Every cached query belongs to whoever was signed in when it ran, and most keys do not carry
    // the user id. Drop the lot whenever the account changes (signed out, expired, or a different
    // person signed in) before the next render, so nobody ever sees the previous account's data.
    const adopt = (next: Session | null) => {
      const nextId = next?.user.id ?? null;
      if (cacheOwner.current && cacheOwner.current !== nextId) queryClient.clear();
      cacheOwner.current = nextId;
      setSession(next);
    };
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (active) adopt(data.session);
      })
      .catch(() => {
        if (active) adopt(null);
      });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, next) => {
      // Do not call other supabase methods synchronously in here (see supabase-js docs).
      adopt(next);
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [queryClient]);

  // Mirror the signed-in user into the Rust side (hello.ack.userId, /health).
  const userId = session?.user.id ?? null;
  useEffect(() => {
    if (session === undefined) return;
    setCurrentUser(userId).catch((err: unknown) => console.error("set_current_user failed", err));
  }, [session, userId]);

  // Pair with the extension. Keyed on the user rather than the session, which changes on every
  // token refresh.
  const restored = session !== undefined;
  useEffect(() => {
    if (!restored) return;
    if (!userId) {
      unpairExtension().catch((err: unknown) => console.error("unpair extension failed", err));
      return;
    }
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const attempt = () => {
      pairExtension(userId).catch((err: unknown) => {
        console.warn("could not publish the extension pairing secret", err);
        if (!cancelled) retry = setTimeout(attempt, PAIRING_RETRY_MS);
      });
    };
    attempt();
    return () => {
      cancelled = true;
      clearTimeout(retry);
    };
  }, [restored, userId]);

  // OAuth loopback: the Rust server received ?code=... on 127.0.0.1:47831/auth/callback.
  useTauriEvent("auth:callback", ({ code }) => {
    supabase.auth
      .exchangeCodeForSession(code)
      .then(({ error }) => {
        if (error)
          notify({ title: "Sign-in failed", description: error.message, variant: "error" });
      })
      .catch((err: unknown) =>
        notify({ title: "Sign-in failed", description: errorMessage(err), variant: "error" }),
      );
  });
  useTauriEvent("auth:error", ({ error, description }) => {
    notify({ title: "Sign-in failed", description: description ?? error, variant: "error" });
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
      retryProfile: () => void profileQuery.refetch(),
      signOut: async () => {
        if (userId)
          await forgetExtensionPairing(userId).catch((err: unknown) =>
            console.warn("could not delete the extension pairing secret", err),
          );
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
        await setCurrentUser(null);
        queryClient.clear();
      },
    }),
    [
      session,
      userId,
      profileQuery.data,
      profileQuery.isPending,
      profileQuery.error,
      profileQuery.refetch,
      queryClient,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
