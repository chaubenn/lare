import { OAUTH_PROVIDER_LABELS, OAUTH_PROVIDERS, type OAuthProvider } from "@lare/shared";
import { Wordmark } from "@lare/ui/brand";
import { Globe, KeyRound, Mail } from "@lare/ui/icons";
import { Button, FieldError, Input, Label } from "@lare/ui/primitives";
import { useQuery } from "@tanstack/react-query";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { Navigate } from "react-router";
import { PageSpinner } from "@/components/ui/States";
import { WindowScreen } from "@/components/ui/WindowScreen";
import { errorMessage } from "@/lib/errors";
import { notify, notifyError } from "@/lib/notices";
import { queryKeys } from "@/lib/queryKeys";
import { routes } from "@/lib/routes";
import { inTauri, useTauriEvent } from "@/lib/tauri";
import { useAuth } from "./AuthProvider";
import {
  fetchSignInProviders,
  SIGN_IN_WAIT_MS,
  sendEmailOtp,
  signInWithProvider,
  verifyEmailOtp,
} from "./oauth";

/** Sign-in screen. Waits out the session check, then bounces anyone already signed in. */
export function LoginPage() {
  const { session } = useAuth();
  if (session === undefined) return <PageSpinner />;
  if (session) return <Navigate to={routes.feed} replace />;
  return (
    <WindowScreen className="max-w-sm">
      <div className="mb-8 text-center">
        <Wordmark className="justify-center text-xl text-[var(--text)]" markClassName="size-8" />
        <h1 className="mt-6 text-xl font-medium">Sign in to Lare</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Social progress tracking for LeetCode. Log sessions, share what you learned.
        </p>
      </div>
      <LoginForm />
      {!inTauri ? (
        <p className="mt-6 text-center text-xs text-[var(--text-tertiary)]">
          Running in a browser: OAuth needs the desktop app to receive the callback. Use the email
          code instead.
        </p>
      ) : null}
    </WindowScreen>
  );
}

const PROVIDER_ICONS: Record<OAuthProvider, ReactNode> = {
  github: <KeyRound className="size-4" aria-hidden />,
  google: <Globe className="size-4" aria-hidden />,
};

/**
 * The provider buttons, for the providers the Supabase project has switched on. OAuth needs the
 * desktop app to catch the callback, so the browser gets the email code instead.
 */
function LoginForm() {
  const [pending, setPending] = useState<OAuthProvider | null>(null);
  const [waiting, setWaiting] = useState<OAuthProvider | null>(null);
  // Never fails: every provider is offered when the project's settings cannot be read.
  const { data: providers } = useQuery({
    queryKey: queryKeys.authProviders,
    queryFn: fetchSignInProviders,
    staleTime: 5 * 60_000,
  });

  const startOAuth = async (provider: OAuthProvider) => {
    setPending(provider);
    try {
      await signInWithProvider(provider);
      setWaiting(provider);
    } catch (err) {
      notifyError("Couldn't start sign-in", err);
    } finally {
      setPending(null);
    }
  };

  // The browser's part is over once the local server hears back, whichever way it went:
  // AuthProvider finishes the sign-in or reports why it failed.
  useTauriEvent("auth:callback", () => setWaiting(null));
  useTauriEvent("auth:error", () => setWaiting(null));

  // Nothing comes back when the tab is closed or the provider shows an error page of its own, and
  // the local server stops taking the callback after the same wait.
  useEffect(() => {
    if (!waiting) return;
    const timer = setTimeout(() => {
      setWaiting(null);
      notify({
        title: "Sign-in timed out",
        description: `Nothing came back from ${OAUTH_PROVIDER_LABELS[waiting]}. Try again, or use an email code.`,
        variant: "error",
      });
    }, SIGN_IN_WAIT_MS);
    return () => clearTimeout(timer);
  }, [waiting]);

  const offered = providers ?? OAUTH_PROVIDERS;

  return (
    <div className="space-y-3">
      {offered.map((provider) => (
        <Button
          key={provider}
          className="w-full"
          loading={pending === provider}
          disabled={pending !== null || providers === undefined}
          icon={PROVIDER_ICONS[provider]}
          onClick={() => void startOAuth(provider)}
        >
          Continue with {OAUTH_PROVIDER_LABELS[provider]}
        </Button>
      ))}
      {waiting ? (
        <output className="block rounded-[var(--lare-r-2)] border border-[var(--border)] bg-[var(--surface-raised)] p-3 text-center text-xs text-zinc-300">
          Finish signing in with {OAUTH_PROVIDER_LABELS[waiting]} in your browser. This window
          updates automatically.{" "}
          <button
            type="button"
            className="text-[var(--text-tertiary)] underline hover:text-zinc-300"
            onClick={() => setWaiting(null)}
          >
            Cancel
          </button>
        </output>
      ) : null}

      {offered.length > 0 ? (
        <div className="flex items-center gap-3 py-2 text-xs text-[var(--text-tertiary)]">
          <span className="h-px flex-1 bg-zinc-800" />
          or
          <span className="h-px flex-1 bg-zinc-800" />
        </div>
      ) : null}

      <EmailOtpForm />
    </div>
  );
}

/** Two stages in one form: ask for the address, then for the six-digit code sent to it. */
function EmailOtpForm() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submitEmail = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const trimmed = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError("Enter a valid email address.");
      return;
    }
    setBusy(true);
    try {
      await sendEmailOtp(trimmed);
      setStage("code");
      notify({ title: "Code sent", description: `Check ${trimmed} for a 6-digit code.` });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const token = code.replace(/\s+/g, "");
    if (!/^\d{6}$/.test(token)) {
      setError("The code is 6 digits.");
      return;
    }
    setBusy(true);
    try {
      await verifyEmailOtp(email.trim(), token);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (stage === "code") {
    return (
      <form onSubmit={(e) => void submitCode(e)} className="space-y-2">
        <Label htmlFor="otp-code" hint={`sent to ${email.trim()}`}>
          6-digit code
        </Label>
        <div className="flex gap-2">
          <Input
            id="otp-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="123456"
            className="font-mono tracking-widest"
          />
          <Button type="submit" variant="primary" loading={busy}>
            Verify
          </Button>
        </div>
        <FieldError>{error}</FieldError>
        <button
          type="button"
          className="text-xs text-[var(--text-tertiary)] hover:text-zinc-300"
          onClick={() => {
            setStage("email");
            setCode("");
            setError(null);
          }}
        >
          Use a different email
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={(e) => void submitEmail(e)} className="space-y-2">
      <Label htmlFor="otp-email">Email</Label>
      <div className="flex gap-2">
        <Input
          id="otp-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
        />
        <Button type="submit" loading={busy} icon={<Mail className="size-4" aria-hidden />}>
          Send code
        </Button>
      </div>
      <FieldError>{error}</FieldError>
    </form>
  );
}
