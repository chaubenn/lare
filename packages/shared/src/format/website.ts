/** Optional website link on a profile: a bare link (e.g. "example.com") is a plainer, more
 * common thing for someone to type than a full URL, so it is stored as-is and only turned
 * into a proper href/display form here, shared by the web and desktop profile pages.
 */

const SCHEME_RE = /^https?:\/\//i;

/** A clickable href -- assumes https when the stored value has no scheme. */
export function websiteHref(raw: string): string {
  const trimmed = raw.trim();
  return SCHEME_RE.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/** Display form: the scheme and one trailing slash are just noise. */
export function websiteLabel(raw: string): string {
  return raw.trim().replace(SCHEME_RE, "").replace(/\/$/, "");
}
