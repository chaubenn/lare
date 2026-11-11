import { Collapsible } from "@lare/ui/primitives";
import { useMemo } from "react";
import { sanitizeHtml } from "@/lib/sanitize";

export function ProblemDescription({ html }: { html: string | null | undefined }) {
  const clean = useMemo(() => sanitizeHtml(html), [html]);
  if (!clean) return null;
  return (
    <Collapsible summary="Problem description">
      <div
        className="lare-prose select-text"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitised with DOMPurify in sanitizeHtml()
        dangerouslySetInnerHTML={{ __html: clean }}
      />
    </Collapsible>
  );
}
