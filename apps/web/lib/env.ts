import { BUNNY_LIBRARY_ID } from "@lare/shared";

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing environment variable ${name}. Copy apps/web/.env.example to .env.local.`,
    );
  }
  return value;
}

/**
 * Public runtime configuration. `NEXT_PUBLIC_*` variables are inlined into client bundles,
 * so they must be referenced literally (no dynamic keys).
 */
export const env = {
  get supabaseUrl(): string {
    return required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);
  },
  get supabaseKey(): string {
    return required(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    );
  },
  get siteUrl(): string {
    return (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  },
  get bunnyLibraryId(): number {
    const raw = process.env.NEXT_PUBLIC_BUNNY_LIBRARY_ID;
    const parsed = raw ? Number(raw) : Number.NaN;
    return Number.isFinite(parsed) ? parsed : BUNNY_LIBRARY_ID;
  },
};

export const GITHUB_REPO_URL = "https://github.com/chaubenn/lare";
export const GITHUB_RELEASES_URL = `${GITHUB_REPO_URL}/releases`;
