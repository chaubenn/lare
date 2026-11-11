import DOMPurify from "dompurify";
import { leetCodeImageSrc } from "./links";

const purifier = DOMPurify(window);

purifier.addHook("afterSanitizeAttributes", (node) => {
  // Never let LeetCode HTML open links inside the webview.
  if (node.tagName === "A") {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
  // The description is written by whoever published the post, so an image from anywhere but
  // LeetCode's own hosts would tell that person who viewed it and when.
  if (node.tagName === "IMG") {
    const src = leetCodeImageSrc(node.getAttribute("src"));
    if (src) {
      node.setAttribute("src", src);
    } else {
      node.removeAttribute("src");
      node.remove();
    }
  }
});

/** Sanitise problem description HTML from LeetCode before rendering it. */
export function sanitizeHtml(html: string | null | undefined): string {
  if (!html) return "";
  return purifier.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: [
      "style",
      "script",
      "iframe",
      "form",
      "input",
      "button",
      "video",
      "audio",
      "source",
      "track",
      "picture",
    ],
    // `class` is dropped too: the prose styles go by element, and a class would let the author
    // dress the description up with any of the app's own utility classes (a full-window overlay).
    FORBID_ATTR: ["style", "onerror", "onload", "class", "srcset", "background", "poster"],
  });
}
