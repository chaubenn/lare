"use client";

import { Check, Link2 } from "lucide-react";
import { useEffect, useState } from "react";
import { buttonSecondary } from "@/lib/styles";

export function CopyLinkButton({ path }: { path: string }) {
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
    <button type="button" onClick={copy} className={`${buttonSecondary} px-3 py-1.5 text-xs`}>
      {copied ? <Check className="size-3.5 text-emerald-400" /> : <Link2 className="size-3.5" />}
      {copied ? "Copied" : "Copy link"}
    </button>
  );
}
