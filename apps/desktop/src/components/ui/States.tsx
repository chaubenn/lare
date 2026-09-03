import { cn } from "@lare/ui";
import { CircleAlert, LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";
import { errorMessage } from "@/lib/supabase";
import { Button } from "./Button";

export function Spinner({ className, label }: { className?: string; label?: string }) {
  return (
    <output className={cn("flex items-center justify-center gap-2 text-zinc-500", className)}>
      <LoaderCircle className="size-4 animate-spin" aria-hidden />
      {label ? <span className="text-sm">{label}</span> : <span className="sr-only">Loading</span>}
    </output>
  );
}

export function PageSpinner({ label = "Loading…" }: { label?: string }) {
  return <Spinner className="py-20" label={label} />;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-800 px-6 py-14 text-center",
        className,
      )}
    >
      {icon ? <div className="mb-3 text-zinc-600">{icon}</div> : null}
      <h3 className="text-sm font-semibold text-zinc-200">{title}</h3>
      {description ? (
        <div className="mt-1 max-w-md text-sm leading-relaxed text-zinc-500">{description}</div>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  error,
  onRetry,
  title = "Couldn't load this",
}: {
  error: unknown;
  onRetry?: () => void;
  title?: string;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center rounded-xl border border-rose-500/20 bg-rose-500/5 px-6 py-10 text-center"
    >
      <CircleAlert className="mb-2 size-5 text-rose-400" aria-hidden />
      <h3 className="text-sm font-semibold text-rose-200">{title}</h3>
      <p className="mt-1 max-w-md break-words text-sm text-rose-300/80">{errorMessage(error)}</p>
      {onRetry ? (
        <Button className="mt-4" size="sm" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}
