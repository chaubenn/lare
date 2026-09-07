"use client";

import { LoaderCircle } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "../cn";
import {
  BUTTON_BASE,
  BUTTON_SIZES,
  BUTTON_VARIANTS,
  type ButtonSize,
  type ButtonVariant,
} from "./button-styles";
import { Tooltip } from "./Tooltip";

export {
  BUTTON_BASE,
  BUTTON_SIZES,
  BUTTON_VARIANTS,
  type ButtonSize,
  type ButtonVariant,
  buttonClass,
} from "./button-styles";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
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
      className={cn(BUTTON_BASE, BUTTON_VARIANTS[variant], BUTTON_SIZES[size], className)}
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
