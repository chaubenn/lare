import { cn } from "@lare/ui";
import { Check, Link2 } from "lucide-react";
import { useEffect, useState } from "react";
import { copyText } from "@/lib/clipboard";
import { postWebUrl } from "@/lib/env";

/**
 * Copies the post's public web URL. Mirrors the web feed's button (same label, same inline
 * "Copied" feedback) so both apps look identical.
 */
export function PostLinkButton({ postSlug, className }: { postSlug: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(t);
  }, [copied]);

  async function copy() {
    const ok = await copyText(postWebUrl(postSlug));
    if (ok) setCopied(true);
  }

  return (
    <button
      type="button"
      onClick={() => void copy()}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:border-zinc-700 hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
    >
      {copied ? <Check className="size-3.5 text-emerald-400" /> : <Link2 className="size-3.5" />}
      {copied ? "Copied" : "Post Link"}
    </button>
  );
}
