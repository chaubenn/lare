import { defineConfig } from "wxt";

// Public key of ~/.lare/extension-key.pem. Pins the extension id to
// koplffaeeahehnfikinmldhhmmldghhl for unpacked/dev installs so the Supabase
// redirect URL and the desktop app's Origin allow-list stay stable.
const EXTENSION_PUBLIC_KEY =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAwHZTYeXvkEu4dQZRIIN9mjUDIACyRbCBVZ811l7xe11KPORACOzHs7IE64zPiVt776GN3FUxL0V6CnIxyJfYT9rvuMUQlVF/0SYzjrw1c4nYqWrgEwaMuzPtte4WQnUAEOdgJSXkVrRgDMScRje1TcF1G0vKTdAV0Q8EvcIPW2xDc7SKOlD/dzjcaJAImcJdTz2LRY9VrEEjemTXBU02BUbFgCD1WzdPWnJfcrnFl2lZpEdtqaOxHmKOKxI9XloGc0oDn88goIqVpPTfjQmT3nt7I0JP7AdD3Uqz0dAU0Xaqe+joILozrrIa+skDi3UQc7xoqDKlP0xihlu4w98I0wIDAQAB";

// One id per build, shared by every entrypoint. An unpacked extension's pages load the new files
// from disk straight away, but its service worker keeps running the old build until reloaded; the
// side panel compares ids to catch that.
const BUILD_ID = Date.now().toString(36);

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  srcDir: ".",
  outDir: ".output",
  manifest: ({ mode }) => ({
    name: mode === "development" ? "Lare for LeetCode (dev)" : "Lare for LeetCode",
    short_name: "Lare",
    description:
      "Track LeetCode problems and submissions, and run AI-graded mock interviews recorded by the Lare desktop app.",
    key: process.env.LARE_EXTENSION_KEY ?? EXTENSION_PUBLIC_KEY,
    permissions: [
      "storage",
      "identity",
      "alarms",
      "tabs",
      "activeTab",
      "sidePanel",
      // Loads the content scripts into LeetCode tabs opened before an install or update.
      "scripting",
    ],
    side_panel: { default_path: "sidepanel.html" },
    host_permissions: [
      "https://leetcode.com/*",
      "https://jndqrvwkwoyvzoqcveev.supabase.co/*",
      "http://127.0.0.1/*",
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
      __EXT_VERSION__: JSON.stringify(process.env.npm_package_version ?? "0.5.0"),
      __BUILD_ID__: JSON.stringify(BUILD_ID),
    },
  }),
});
