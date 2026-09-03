"use client";

import { LoaderCircle, Mail } from "lucide-react";
import { type FormEvent, useState } from "react";
import { GitHubIcon, GoogleIcon } from "@/components/brand-icons";
import { buttonPrimary, buttonSecondary, inputClass, labelClass } from "@/lib/styles";
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
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState<Provider | "otp" | "verify" | null>(null);
  const [error, setError] = useState<string | null>(initialError);

  const callbackUrl = `${siteUrl}/auth/callback?next=${encodeURIComponent(next)}`;

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
        <button
          type="button"
          onClick={() => signInWith("github")}
          disabled={busy !== null}
          className={buttonPrimary}
        >
          {busy === "github" ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <GitHubIcon className="size-4" />
          )}
          Continue with GitHub
        </button>
        <button
          type="button"
          onClick={() => signInWith("google")}
          disabled={busy !== null}
          className={buttonSecondary}
        >
          {busy === "google" ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <GoogleIcon className="size-4" />
          )}
          Continue with Google
        </button>
      </div>

      <div className="flex items-center gap-3 text-xs uppercase tracking-wide text-zinc-600">
        <span className="h-px flex-1 bg-zinc-800" />
        or email
        <span className="h-px flex-1 bg-zinc-800" />
      </div>

      {step === "email" ? (
        <form onSubmit={sendCode} className="space-y-3">
          <div className="space-y-1.5">
            <label htmlFor="email" className={labelClass}>
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className={inputClass}
            />
          </div>
          <button
            type="submit"
            disabled={busy !== null || email.trim().length === 0}
            className={`${buttonSecondary} w-full`}
          >
            {busy === "otp" ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Mail className="size-4" />
            )}
            Send me a code
          </button>
        </form>
      ) : (
        <form onSubmit={verifyCode} className="space-y-3">
          <p className="text-sm text-zinc-400">
            We sent a 6-digit code to <span className="text-zinc-200">{email}</span>.
          </p>
          <div className="space-y-1.5">
            <label htmlFor="code" className={labelClass}>
              Code
            </label>
            <input
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
              className={`${inputClass} font-mono text-lg tracking-[0.4em]`}
            />
          </div>
          <button
            type="submit"
            disabled={busy !== null || code.length !== 6}
            className={`${buttonPrimary} w-full`}
          >
            {busy === "verify" && <LoaderCircle className="size-4 animate-spin" />}
            Verify and sign in
          </button>
          <button
            type="button"
            onClick={() => {
              setStep("email");
              setCode("");
              setError(null);
            }}
            className="w-full text-center text-xs text-zinc-500 hover:text-zinc-300"
          >
            Use a different email
          </button>
        </form>
      )}

      {error && (
        <p
          role="alert"
          className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300"
        >
          {error}
        </p>
      )}
    </div>
  );
}
