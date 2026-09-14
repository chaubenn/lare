"use client";

import { Button } from "@lare/ui/primitives";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

export function RefreshWorkspace() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      loading={pending}
      onClick={() => startTransition(() => router.refresh())}
    >
      Refresh synced data
    </Button>
  );
}
