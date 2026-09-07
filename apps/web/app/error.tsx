"use client";

import { Button, Container } from "@lare/ui/primitives";
import { useEffect } from "react";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <Container width="prose" className="py-16 text-center">
      <p className="lare-label text-[var(--text-tertiary)]">Error</p>
      <h1 className="lare-title mt-2 text-[var(--text)]">Something went wrong</h1>
      <p className="mt-2 text-sm text-[var(--text-secondary)]">
        {error.digest ? `Reference: ${error.digest}` : "Please try again in a moment."}
      </p>
      <Button type="button" variant="primary" onClick={reset} className="mt-6">
        Try again
      </Button>
    </Container>
  );
}
