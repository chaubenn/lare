"use client";

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
    <div className="mx-auto max-w-md py-16 text-center">
      <p className="font-mono text-xs uppercase tracking-widest text-zinc-500">Error</p>
      <h1 className="mt-2 text-2xl font-semibold text-zinc-50">Something went wrong</h1>
      <p className="mt-2 text-sm text-zinc-400">
        {error.digest ? `Reference: ${error.digest}` : "Please try again in a moment."}
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-6 inline-flex rounded-lg bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-white"
      >
        Try again
      </button>
    </div>
  );
}
