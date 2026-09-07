"use client";

import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { cn } from "../cn";

const CONTROL =
  "w-full rounded-[var(--lare-r-2)] border border-[var(--border)] bg-[color-mix(in_oklab,var(--surface-raised)_70%,transparent)] px-3 text-sm text-[var(--text)] placeholder:text-[var(--text-tertiary)] focus:border-[var(--border-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] disabled:opacity-50";

export function Label({
  children,
  hint,
  htmlFor,
  className,
}: {
  children: ReactNode;
  hint?: ReactNode;
  htmlFor?: string;
  className?: string;
}) {
  return (
    <label htmlFor={htmlFor} className={cn("block", className)}>
      <span className="text-xs font-medium text-[var(--text-secondary)]">{children}</span>
      {hint ? <span className="ml-2 text-xs text-[var(--text-tertiary)]">{hint}</span> : null}
    </label>
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(CONTROL, "h-9", className)} {...rest} />;
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(CONTROL, "min-h-24 py-2 leading-relaxed", className)} {...rest} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(CONTROL, "h-9 appearance-none pr-8", className)} {...rest}>
      {children}
    </select>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  id,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  id: string;
  disabled?: boolean;
}) {
  return (
    <label
      htmlFor={id}
      className={cn(
        "flex items-start justify-between gap-4 rounded-[var(--lare-r-2)] border border-[var(--border)] bg-[color-mix(in_oklab,var(--surface-raised)_40%,transparent)] p-3",
        disabled && "opacity-50",
      )}
    >
      <span className="min-w-0">
        <span className="block text-sm text-[var(--text)]">{label}</span>
        {description ? (
          <span className="block text-xs text-[var(--text-tertiary)]">{description}</span>
        ) : null}
      </span>
      <input
        id={id}
        type="checkbox"
        role="switch"
        aria-checked={checked}
        className="peer sr-only"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span
        aria-hidden
        className="relative mt-0.5 inline-flex h-5 w-9 shrink-0 rounded-full bg-[var(--border-strong)] transition-colors duration-(--toggle-dur,350ms) ease-(--ease-smooth-out) peer-checked:bg-[var(--accent)] peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--focus)] after:absolute after:top-0.5 after:left-0.5 after:size-4 after:rounded-full after:bg-[var(--surface)] after:transition-transform peer-checked:after:translate-x-4"
      />
    </label>
  );
}

export function FieldError({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <p className="mt-1 text-xs text-[var(--lare-danger)]">{children}</p>;
}
