"use client";

import { LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

/** Submit button that disables itself and shows a spinner while its parent form is pending. */
export function PendingButton({
  children,
  className,
  title,
}: {
  children: ReactNode;
  className: string;
  title?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={className} title={title}>
      {pending && <LoaderCircle className="size-3.5 animate-spin" />}
      {children}
    </button>
  );
}
