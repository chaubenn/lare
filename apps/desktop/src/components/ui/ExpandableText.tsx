import { cn } from "@lare/ui";
import { useLayoutEffect, useRef, useState } from "react";

/**
 * Plain text that keeps the author's line breaks and clamps to three lines, with a
 * "See more" control only when something is actually hidden.
 */
export function ExpandableText({ text, className }: { text: string; className?: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);

  useLayoutEffect(() => {
    // An expanded paragraph never reports overflow, which would pull the
    // control out from under the reader mid-read. Only measure while clamped.
    if (expanded) return;
    const el = ref.current;
    if (!el) return;
    const measure = () => setOverflows(el.scrollHeight > el.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [expanded]);

  return (
    <div>
      <p
        ref={ref}
        className={cn(
          "whitespace-pre-wrap text-sm leading-relaxed",
          !expanded && "line-clamp-3",
          className,
        )}
      >
        {text}
      </p>
      {overflows || expanded ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="mt-1 rounded-[var(--lare-r-1)] text-sm font-medium text-[var(--text-tertiary)] hover:text-[var(--text)] focus-visible:outline-2 focus-visible:outline-[var(--focus)]"
        >
          {expanded ? "See less" : "See more"}
        </button>
      ) : null}
    </div>
  );
}
