import { useMemo } from "react";
import { Collapsible } from "@/components/ui/Collapsible";
import { sanitizeHtml } from "@/lib/sanitize";

export function ProblemDescription({
  html,
  defaultOpen = false,
}: {
  html: string | null | undefined;
  defaultOpen?: boolean;
}) {
  const clean = useMemo(() => sanitizeHtml(html), [html]);
  if (!clean) return null;
  return (
    <Collapsible summary="Problem description" defaultOpen={defaultOpen}>
      <div
        className="lare-prose select-text"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitised with DOMPurify in sanitizeHtml()
        dangerouslySetInnerHTML={{ __html: clean }}
      />
    </Collapsible>
  );
}
