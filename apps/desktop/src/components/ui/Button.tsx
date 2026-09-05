import { cn } from "@lare/ui";
import { LoaderCircle } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Tooltip } from "./Tooltip";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-zinc-100 text-zinc-950 hover:bg-zinc-50 disabled:hover:bg-zinc-100 font-medium",
  secondary: "border border-zinc-800 bg-zinc-900 text-zinc-100 hover:bg-zinc-800",
  ghost: "text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100",
  danger: "border border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 px-3 text-xs gap-1.5",
  md: "h-9 px-4 text-sm gap-2",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
  /** Visual hover/focus hint. Icon-only buttons also inherit this from `aria-label`. */
  tooltip?: string;
  tooltipAlign?: "start" | "center" | "end";
}

export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  icon,
  tooltip,
  tooltipAlign,
  className,
  children,
  disabled,
  type = "button",
  ...rest
}: ButtonProps) {
  const hasChildren = children !== undefined && children !== null && children !== false;
  const ariaLabel = typeof rest["aria-label"] === "string" ? rest["aria-label"] : undefined;
  const tip = tooltip ?? (!hasChildren ? ariaLabel : undefined);

  const button = (
    <button
      type={type}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center rounded-lg transition-colors duration-(--duration-fast) ease-(--ease-smooth-out) disabled:cursor-not-allowed disabled:opacity-50",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {loading ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );

  return tip ? (
    <Tooltip label={tip} align={tooltipAlign ?? "center"}>
      {button}
    </Tooltip>
  ) : (
    button
  );
}
