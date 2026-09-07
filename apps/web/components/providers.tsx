"use client";

import { ToastProvider } from "@lare/ui/primitives";
import type { ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>;
}
