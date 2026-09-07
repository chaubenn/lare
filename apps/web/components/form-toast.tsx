"use client";

import { useToast } from "@lare/ui/primitives";
import { useEffect, useRef } from "react";

/** Surfaces a server-action error on a toast without turning the page into a client component. */
export function FormToast({ error }: { error: string | null }) {
  const { error: toastError } = useToast();
  const last = useRef<string | null>(null);

  useEffect(() => {
    if (!error || error === last.current) return;
    last.current = error;
    toastError(error);
  }, [error, toastError]);

  return null;
}
