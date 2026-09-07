"use client";

import { Button } from "@lare/ui/primitives";
import { Check, Link2 } from "lucide-react";
import { useEffect, useState } from "react";

export function CopyLinkButton({ path, className }: { path: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(t);
  }, [copied]);

  async function copy() {
    const url = `${window.location.origin}${path}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      window.prompt("Copy this link", url);
    }
  }

  return (
    <Button type="button" size="sm" onClick={copy} className={className}>
      {copied ? (
        <Check className="size-3.5 text-[var(--lare-status-run)]" />
      ) : (
        <Link2 className="size-3.5" />
      )}
      {copied ? "Copied" : "Post Link"}
    </Button>
  );
}
