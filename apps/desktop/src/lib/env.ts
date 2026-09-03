import { BUNNY_LIBRARY_ID } from "@lare/shared";
import { z } from "zod";

const EnvSchema = z.object({
  VITE_SUPABASE_URL: z.url(),
  VITE_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  VITE_SITE_URL: z.url().default("http://localhost:3000"),
  VITE_BUNNY_LIBRARY_ID: z.coerce.number().int().positive().default(BUNNY_LIBRARY_ID),
});

export type Env = z.infer<typeof EnvSchema>;

const parsed = EnvSchema.safeParse(import.meta.env);

/** Human-readable configuration problem, or null when the .env is complete. */
export const envError: string | null = parsed.success
  ? null
  : `Missing or invalid environment: ${parsed.error.issues
      .map((i) => `${i.path.join(".")} (${i.message})`)
      .join(", ")}. Copy apps/desktop/.env.example to apps/desktop/.env.`;

export const env: Env = parsed.success
  ? parsed.data
  : {
      VITE_SUPABASE_URL: "http://invalid.local",
      VITE_SUPABASE_PUBLISHABLE_KEY: "missing",
      VITE_SITE_URL: "http://localhost:3000",
      VITE_BUNNY_LIBRARY_ID: BUNNY_LIBRARY_ID,
    };

/** Public URL of a post on the web app. */
export function postWebUrl(postId: string): string {
  return `${env.VITE_SITE_URL.replace(/\/$/, "")}/p/${postId}`;
}

/** Public URL of a profile on the web app. */
export function profileWebUrl(handle: string): string {
  return `${env.VITE_SITE_URL.replace(/\/$/, "")}/u/${handle}`;
}
