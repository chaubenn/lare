/**
 * The site is a landing page: no Supabase, no Bunny, no viewer. All it needs is its own URL for
 * `metadataBase` and where to send people for the downloads.
 */
export const env = {
  get siteUrl(): string {
    return (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  },
};

export const GITHUB_REPO_URL = "https://github.com/chaubenn/lare";
export const GITHUB_RELEASES_URL = `${GITHUB_REPO_URL}/releases`;
