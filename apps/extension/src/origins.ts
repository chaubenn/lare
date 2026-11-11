/**
 * The pages Lare runs on. `wxt.config.ts` is loaded outside Vite (no `import.meta.env`), so its
 * host permissions and web-accessible matches repeat these patterns by hand.
 */
import { LEETCODE_ORIGIN } from "@lare/shared";

const LEETCODE_PAGES = `${LEETCODE_ORIGIN}/*`;
/** The e2e fixture page. Host permission for it only exists outside production builds. */
const FIXTURE_PAGES = "http://localhost/*";

/**
 * Content-script matches. All of leetcode.com, not just problem URLs: LeetCode navigates in-page,
 * so a script that only loads on /problems/* never arrives when a problem is opened from the list
 * or the home page.
 */
export function contentScriptMatches(): string[] {
  const matches = [LEETCODE_PAGES];
  const fixtureOrigin = import.meta.env.WXT_DEV_FIXTURE_ORIGIN;
  if (import.meta.env.MODE !== "production" && fixtureOrigin) matches.push(`${fixtureOrigin}/*`);
  return matches;
}

/** Tabs with a content script to inject into or broadcast to, as a `chrome.tabs.query` filter. */
export const LEETCODE_TABS = { url: LEETCODE_PAGES };
/** The same plus the fixture page, which a production build simply has no access to. */
export const PAGE_TABS = { url: [LEETCODE_PAGES, FIXTURE_PAGES] };

export function isLeetcodeUrl(url: string | undefined): boolean {
  return url?.startsWith(`${LEETCODE_ORIGIN}/`) ?? false;
}
