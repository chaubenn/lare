import DOMPurify from "dompurify";

const purifier = DOMPurify(window);

// Never let LeetCode HTML open links inside the webview.
purifier.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});

/** Sanitise problem description HTML from LeetCode before rendering it. */
export function sanitizeHtml(html: string | null | undefined): string {
  if (!html) return "";
  return purifier.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["style", "script", "iframe", "form", "input", "button"],
    FORBID_ATTR: ["style", "onerror", "onload"],
  });
}
