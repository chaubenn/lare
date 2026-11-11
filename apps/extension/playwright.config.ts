import { defineConfig } from "@playwright/test";
import { FIXTURE_ORIGIN, FIXTURE_PORT } from "./e2e/constants.mjs";

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.spec\.ts/,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: FIXTURE_ORIGIN,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node e2e/fixture/server.mjs",
    port: FIXTURE_PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
