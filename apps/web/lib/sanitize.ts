import "server-only";

import sanitize from "sanitize-html";

const FORBIDDEN_TAGS = new Set([
  "style",
  "script",
  "iframe",
  "form",
  "input",
  "button",
  "object",
  "embed",
]);

/**
 * LeetCode problem HTML -> safe HTML. `sanitize-html` stays off jsdom so this
 * can run in Vercel serverless; isomorphic-dompurify's jsdom import crashes there.
 * Links open in a new tab without a referrer.
 */
export function sanitizeHtml(html: string): string {
  return sanitize(html, {
    allowedTags: [
      ...sanitize.defaults.allowedTags.filter((tag) => !FORBIDDEN_TAGS.has(tag)),
      "img",
    ],
    allowedAttributes: {
      ...sanitize.defaults.allowedAttributes,
      a: ["href", "name", "target", "rel"],
      img: ["src", "alt", "title", "width", "height"],
      "*": ["class"],
    },
    allowedSchemes: ["http", "https", "data"],
    transformTags: {
      a: (_tagName, attribs) => ({
        tagName: "a",
        attribs: {
          ...attribs,
          target: "_blank",
          rel: "noopener noreferrer",
        },
      }),
    },
  });
}
