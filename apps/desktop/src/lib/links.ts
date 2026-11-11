/**
 * URLs built from, or checked against, what other users stored. Problem rows are written by the
 * extension of whoever published the post, so a stored link or image address is not trusted to
 * point where it claims; these keep both on LeetCode.
 */

/** Hosts LeetCode serves problem images from (the CSP's `img-src` lists the same ones). */
const LEETCODE_IMAGE_HOSTS = new Set([
  "assets.leetcode.com",
  "leetcode.com",
  "s3-lc-upload.s3.amazonaws.com",
]);

const SLUG = /^[a-z0-9-]+$/;

/** The problem's page on LeetCode, or null when `slug` is not one. */
export function leetCodeProblemUrl(slug: string | null | undefined): string | null {
  if (!slug || slug.length > 128 || !SLUG.test(slug)) return null;
  return `https://leetcode.com/problems/${slug}/`;
}

/**
 * `src` as an absolute https URL when it is a LeetCode image, otherwise null. Relative and
 * `http:` addresses are read the way they were on leetcode.com.
 */
export function leetCodeImageSrc(src: string | null | undefined): string | null {
  if (!src) return null;
  let url: URL;
  try {
    url = new URL(src, "https://leetcode.com/");
  } catch {
    return null;
  }
  if (url.protocol === "http:") url.protocol = "https:";
  if (url.protocol !== "https:" || url.port !== "" || url.username || url.password) return null;
  return LEETCODE_IMAGE_HOSTS.has(url.hostname) ? url.href : null;
}
