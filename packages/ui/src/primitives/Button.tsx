"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { LoaderCircle } from "../icons";
import { type ButtonSize, type ButtonVariant, buttonClass } from "./button-styles";
import { Tooltip } from "./Tooltip";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
  /** Visual hover/focus hint. Icon-only buttons also inherit this from `aria-label`; pass `false` to opt out. */
  tooltip?: string | false;
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
  const tip = tooltip === false ? undefined : (tooltip ?? (!hasChildren ? ariaLabel : undefined));

  const button = (
    <button
      type={type}
      disabled={disabled || loading}
      className={buttonClass(variant, size, className)}
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
