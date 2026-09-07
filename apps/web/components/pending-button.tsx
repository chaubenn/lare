"use client";

import { Button, type ButtonProps } from "@lare/ui/primitives";
import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

/** Submit button that disables itself and shows a spinner while its parent form is pending. */
export function PendingButton({
  children,
  variant = "secondary",
  size = "md",
  tooltip,
  className,
}: {
  children: ReactNode;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  tooltip?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant={variant}
      size={size}
      loading={pending}
      tooltip={tooltip}
      className={className}
    >
      {children}
    </Button>
  );
}
