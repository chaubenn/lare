import "server-only";

import DOMPurify from "isomorphic-dompurify";

let hooked = false;

/** LeetCode problem HTML -> safe HTML. Links open in a new tab without a referrer. */
export function sanitizeHtml(html: string): string {
  if (!hooked) {
    hooked = true;
    DOMPurify.addHook("afterSanitizeAttributes", (node) => {
      if (node.tagName === "A") {
        node.setAttribute("target", "_blank");
        node.setAttribute("rel", "noopener noreferrer");
      }
    });
  }
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["style", "script", "iframe", "form", "input", "button", "object", "embed"],
    FORBID_ATTR: ["style", "onerror", "onload"],
    ADD_ATTR: ["target"],
  });
}
