import { cn } from "../cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "icon";

export const BUTTON_BASE =
  "lare-press inline-flex items-center justify-center transition-colors duration-(--duration-fast) ease-(--ease-smooth-out) disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]";

export const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-[var(--accent)] text-[var(--accent-fg)] hover:bg-[var(--lare-paper)] disabled:hover:bg-[var(--accent)] font-medium",
  secondary:
    "border border-[var(--border)] bg-[var(--surface-raised)] text-[var(--text)] hover:bg-[var(--surface-sunken)]",
  ghost: "text-[var(--text-secondary)] hover:bg-[var(--surface-raised)] hover:text-[var(--text)]",
  danger:
    "border border-[color-mix(in_oklab,var(--lare-danger)_30%,transparent)] bg-[color-mix(in_oklab,var(--lare-danger)_10%,transparent)] text-[var(--lare-danger)] hover:bg-[color-mix(in_oklab,var(--lare-danger)_20%,transparent)]",
};

export const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs gap-1.5 rounded-[var(--lare-r-2)]",
  md: "h-9 px-4 text-sm gap-2 rounded-[var(--lare-r-2)]",
  icon: "size-8 p-0 rounded-[var(--lare-r-2)]",
};

export function buttonClass(
  variant: ButtonVariant = "secondary",
  size: ButtonSize = "md",
  className?: string,
): string {
  return cn(BUTTON_BASE, BUTTON_VARIANTS[variant], BUTTON_SIZES[size], className);
}
