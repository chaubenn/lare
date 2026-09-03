import { Globe, KeyRound, Mail } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Navigate } from "react-router";
import { useToast } from "@/components/toast/ToastProvider";
import { Button } from "@/components/ui/Button";
import { FieldError, Input, Label } from "@/components/ui/Field";
import { PageSpinner } from "@/components/ui/States";
import { errorMessage } from "@/lib/supabase";
import { inTauri } from "@/lib/tauri";
import { useAuth } from "./AuthProvider";
import { type OAuthProvider, sendEmailOtp, signInWithProvider, verifyEmailOtp } from "./oauth";

export function LoginPage() {
  const { session } = useAuth();
  if (session === undefined) return <PageSpinner />;
  if (session) return <Navigate to="/" replace />;
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-cyan-500 text-2xl font-bold text-white">
            L
          </div>
          <h1 className="text-xl font-semibold">Sign in to Lare</h1>
          <p className="mt-1 text-sm text-zinc-400">Hevy for LeetCode. Log sessions, share what you learned.</p>
        </div>
        <LoginForm />
        {!inTauri ? (
          <p className="mt-6 text-center text-xs text-zinc-600">
            Running in a browser: OAuth needs the desktop app to receive the callback. Use the email
            code instead.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function LoginForm() {
  const { toast } = useToast();
  const [pending, setPending] = useState<OAuthProvider | null>(null);
  const [waiting, setWaiting] = useState<OAuthProvider | null>(null);

  const startOAuth = async (provider: OAuthProvider) => {
    setPending(provider);
    try {
      await signInWithProvider(provider);
      setWaiting(provider);
    } catch (err) {
      toast({ title: "Couldn't start sign-in", description: errorMessage(err), variant: "error" });
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="space-y-3">
      <Button
        className="w-full"
        loading={pending === "github"}
        disabled={pending !== null}
        icon={<KeyRound className="size-4" aria-hidden />}
        onClick={() => void startOAuth("github")}
      >
        Continue with GitHub
      </Button>
      <Button
        className="w-full"
        loading={pending === "google"}
        disabled={pending !== null}
        icon={<Globe className="size-4" aria-hidden />}
        onClick={() => void startOAuth("google")}
      >
        Continue with Google
      </Button>
      {waiting ? (
        <output className="block rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 text-center text-xs text-emerald-200">
          Finish signing in with {waiting === "github" ? "GitHub" : "Google"} in your browser. This
          window updates automatically.
        </output>
      ) : null}

      <div className="flex items-center gap-3 py-2 text-xs text-zinc-600">
        <span className="h-px flex-1 bg-zinc-800" />
        or
        <span className="h-px flex-1 bg-zinc-800" />
      </div>

      <EmailOtpForm />
    </div>
  );
}

function EmailOtpForm() {
  const { toast } = useToast();
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
      toast({ title: "Code sent", description: `Check ${trimmed} for a 6-digit code.` });
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
          className="text-xs text-zinc-500 hover:text-zinc-300"
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
