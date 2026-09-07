"use client";

import { Button, FieldError, Input, Label, useToast } from "@lare/ui/primitives";
import { Mail } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { GitHubIcon, GoogleIcon } from "@/components/brand-icons";
import { createClient } from "@/lib/supabase/client";

type Provider = "github" | "google";

export function LoginForm({
  next,
  siteUrl,
  initialError,
}: {
  next: string;
  siteUrl: string;
  initialError: string | null;
}) {
  const { error: toastError } = useToast();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState<Provider | "otp" | "verify" | null>(null);
  const [error, setError] = useState<string | null>(initialError);

  const callbackUrl = `${siteUrl}/auth/callback?next=${encodeURIComponent(next)}`;

  useEffect(() => {
    if (error) toastError(error);
  }, [error, toastError]);

  async function signInWith(provider: Provider) {
    setBusy(provider);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: callbackUrl },
    });
    if (error) {
      setError(error.message);
      setBusy(null);
    }
  }

  async function sendCode(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy("otp");
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: callbackUrl },
    });
    setBusy(null);
    if (error) {
      setError(error.message);
      return;
    }
    setStep("code");
  }

  async function verifyCode(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy("verify");
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: code.trim(),
      type: "email",
    });
    if (error) {
      setError(error.message);
      setBusy(null);
      return;
    }
    // Full navigation so the server sees the new session cookies and runs the onboarding check.
    window.location.assign(`/auth/callback?next=${encodeURIComponent(next)}`);
  }

  return (
    <div className="mt-8 space-y-6">
      <div className="grid gap-3">
        <Button
          type="button"
          variant="primary"
          onClick={() => signInWith("github")}
          disabled={busy !== null}
          loading={busy === "github"}
          icon={busy === "github" ? undefined : <GitHubIcon className="size-4" />}
          className="w-full"
        >
          Continue with GitHub
        </Button>
        <Button
          type="button"
          onClick={() => signInWith("google")}
          disabled={busy !== null}
          loading={busy === "google"}
          icon={busy === "google" ? undefined : <GoogleIcon className="size-4" />}
          className="w-full"
        >
          Continue with Google
        </Button>
      </div>

      <div className="flex items-center gap-3 text-xs uppercase tracking-wide text-[var(--text-tertiary)]">
        <span className="h-px flex-1 bg-[var(--border)]" />
        or email
        <span className="h-px flex-1 bg-[var(--border)]" />
      </div>

      {step === "email" ? (
        <form onSubmit={sendCode} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </div>
          <Button
            type="submit"
            disabled={busy !== null || email.trim().length === 0}
            loading={busy === "otp"}
            icon={busy === "otp" ? undefined : <Mail className="size-4" />}
            className="w-full"
          >
            Send me a code
          </Button>
        </form>
      ) : (
        <form onSubmit={verifyCode} className="space-y-3">
          <p className="text-sm text-[var(--text-secondary)]">
            We sent a 6-digit code to <span className="text-[var(--text)]">{email}</span>.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="code">Code</Label>
            <Input
              id="code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="123456"
              className="font-mono text-lg tracking-[0.4em]"
            />
          </div>
          <Button
            type="submit"
            variant="primary"
            disabled={busy !== null || code.length !== 6}
            loading={busy === "verify"}
            className="w-full"
          >
            Verify and sign in
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setStep("email");
              setCode("");
              setError(null);
            }}
            className="w-full"
          >
            Use a different email
          </Button>
        </form>
      )}

      <FieldError>{error}</FieldError>
    </div>
  );
}
