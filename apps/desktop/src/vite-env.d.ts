/// <reference types="vite/client" />

/** The shipped app version, baked in from package.json by vite.config.ts. */
declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY: string;
  readonly VITE_SITE_URL?: string;
  readonly VITE_BUNNY_LIBRARY_ID?: string;
}
