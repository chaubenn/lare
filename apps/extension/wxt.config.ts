import { defineConfig } from "wxt";

// Public key of ~/.lare/extension-key.pem. Pins the extension id to
// koplffaeeahehnfikinmldhhmmldghhl for unpacked/dev installs so the Supabase
// redirect URL and the desktop app's Origin allow-list stay stable.
const EXTENSION_PUBLIC_KEY =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAwHZTYeXvkEu4dQZRIIN9mjUDIACyRbCBVZ811l7xe11KPORACOzHs7IE64zPiVt776GN3FUxL0V6CnIxyJfYT9rvuMUQlVF/0SYzjrw1c4nYqWrgEwaMuzPtte4WQnUAEOdgJSXkVrRgDMScRje1TcF1G0vKTdAV0Q8EvcIPW2xDc7SKOlD/dzjcaJAImcJdTz2LRY9VrEEjemTXBU02BUbFgCD1WzdPWnJfcrnFl2lZpEdtqaOxHmKOKxI9XloGc0oDn88goIqVpPTfjQmT3nt7I0JP7AdD3Uqz0dAU0Xaqe+joILozrrIa+skDi3UQc7xoqDKlP0xihlu4w98I0wIDAQAB";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  srcDir: ".",
  outDir: ".output",
  manifest: ({ mode }) => ({
    name: mode === "development" ? "Lare for LeetCode (dev)" : "Lare for LeetCode",
    short_name: "Lare",
    description:
      "Log LeetCode sessions with a pausable timer, capture submissions, and run AI-graded mock interviews with the Lare desktop app.",
    key: process.env.LARE_EXTENSION_KEY ?? EXTENSION_PUBLIC_KEY,
    permissions: ["storage", "identity", "alarms", "tabs"],
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
      default_icon: {
        16: "icon-16.png",
        32: "icon-32.png",
        48: "icon-48.png",
        128: "icon-128.png",
      },
    },
    web_accessible_resources: [
      {
        resources: ["emblem.png"],
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
      __EXT_VERSION__: JSON.stringify(process.env.npm_package_version ?? "0.1.0"),
    },
  }),
});
