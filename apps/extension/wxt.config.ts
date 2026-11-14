import { readFileSync } from "node:fs";
import { defineConfig } from "wxt";

// Public key of ~/.lare/extension-key.pem. Pins the extension id to
// koplffaeeahehnfikinmldhhmmldghhl for unpacked/dev installs so the Supabase
// redirect URL and the desktop app's Origin allow-list stay stable.
const EXTENSION_PUBLIC_KEY =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAwHZTYeXvkEu4dQZRIIN9mjUDIACyRbCBVZ811l7xe11KPORACOzHs7IE64zPiVt776GN3FUxL0V6CnIxyJfYT9rvuMUQlVF/0SYzjrw1c4nYqWrgEwaMuzPtte4WQnUAEOdgJSXkVrRgDMScRje1TcF1G0vKTdAV0Q8EvcIPW2xDc7SKOlD/dzjcaJAImcJdTz2LRY9VrEEjemTXBU02BUbFgCD1WzdPWnJfcrnFl2lZpEdtqaOxHmKOKxI9XloGc0oDn88goIqVpPTfjQmT3nt7I0JP7AdD3Uqz0dAU0Xaqe+joILozrrIa+skDi3UQc7xoqDKlP0xihlu4w98I0wIDAQAB";

// The Chrome Web Store assigns its own id and key, so a store package carries no `key`
// (`LARE_STORE_BUILD=1`, see `pnpm zip:store`). Every other build keeps the pinned id, which the
// desktop app and Supabase allow-list.
const STORE_BUILD = Boolean(process.env.LARE_STORE_BUILD);

// One id per build, shared by every entrypoint. An unpacked extension's pages load the new files
// from disk straight away, but its service worker keeps running the old build until reloaded; the
// side panel compares ids to catch that.
const BUILD_ID = Date.now().toString(36);

// Read from package.json rather than `npm_package_version`, which is only set under a package
// manager's script runner.
const { version: EXT_VERSION } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string };

/**
 * The Supabase project is compiled into the bundle from `WXT_SUPABASE_URL` and
 * `WXT_SUPABASE_PUBLISHABLE_KEY` (the release workflows set them; locally they come from
 * `apps/extension/.env`). Without them the package still builds, loads and passes store review,
 * and then answers every sign-in with "supabaseUrl is required", which is how the 3.5.0 store
 * package shipped. So a build or zip without them fails instead.
 */
function requireSupabaseEnv(): void {
  const missing = ["WXT_SUPABASE_URL", "WXT_SUPABASE_PUBLISHABLE_KEY"].filter(
    (name) => !process.env[name],
  );
  if (missing.length === 0) return;
  const them = missing.length > 1 ? "them" : "it";
  throw new Error(
    `${missing.join(" and ")} must be set to build the extension: nobody could sign in to a build without ${them}. Put ${them} in apps/extension/.env (.github/workflows/release.yml has the values).`,
  );
}

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  srcDir: ".",
  outDir: ".output",
  hooks: {
    // Runs after WXT has loaded the .env files into `process.env`, and not for `wxt prepare`.
    "build:before": (wxt) => {
      if (wxt.config.command === "build") requireSupabaseEnv();
    },
  },
  manifest: ({ mode }) => ({
    name: mode === "development" ? "Lare for LeetCode (dev)" : "Lare for LeetCode",
    short_name: "Lare",
    description:
      "Track LeetCode problems and submissions, and run AI-graded mock interviews recorded by the Lare desktop app.",
    ...(STORE_BUILD ? {} : { key: process.env.LARE_EXTENSION_KEY ?? EXTENSION_PUBLIC_KEY }),
    // No "tabs": every tab URL Lare reads, queries by or injects into is on a host below, and
    // host permissions already expose those.
    permissions: [
      "storage",
      "identity",
      "alarms",
      "sidePanel",
      // Loads the content scripts into LeetCode tabs opened before an install or update.
      "scripting",
    ],
    side_panel: { default_path: "sidepanel.html" },
    // The LeetCode and fixture patterns here and below are spelled again in src/origins.ts.
    host_permissions: [
      "https://leetcode.com/*",
      "https://jndqrvwkwoyvzoqcveev.supabase.co/*",
      // The desktop app's local server (WS_PORT), nothing else on this machine.
      "http://127.0.0.1:47831/*",
      // Local fixture page + mocked backend for e2e tests (dev/e2e builds only).
      ...(mode === "production" ? [] : ["http://localhost/*"]),
    ],
    icons: {
      16: "icon-16.png",
      32: "icon-32.png",
      48: "icon-48.png",
      128: "icon-128.png",
    },
    action: {
      default_title: "Lare",
      // Exact renders for 1x, 1.5x and 2x toolbars, so Chrome never resamples the star.
      default_icon: {
        16: "icon-16.png",
        24: "icon-24.png",
        32: "icon-32.png",
        48: "icon-48.png",
        128: "icon-128.png",
      },
    },
    web_accessible_resources: [
      {
        resources: ["emblem.png", "fonts/*.woff2", "assets/*", "*.woff2"],
        matches: [
          "https://leetcode.com/*",
          ...(mode === "production" ? [] : ["http://localhost/*"]),
        ],
      },
    ],
    minimum_chrome_version: "116",
  }),
  vite: () => ({
    define: {
      __EXT_VERSION__: JSON.stringify(EXT_VERSION),
      __BUILD_ID__: JSON.stringify(BUILD_ID),
    },
  }),
});
