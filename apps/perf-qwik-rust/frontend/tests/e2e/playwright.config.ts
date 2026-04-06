import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.join(here, "../..");
const authFile = path.join(here, ".auth", "dev.json");

const sharedChrome = { ...devices["Desktop Chrome"] };

export default defineConfig({
  testDir: here,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 30_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:5173",
    trace: "retain-on-failure",
    video: "off",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts$/ },
    {
      name: "chromium-auth",
      dependencies: ["setup"],
      testMatch: /app\.spec\.ts$/,
      grepInvert: /\[RT-02\]/,
      use: {
        ...sharedChrome,
        storageState: authFile,
      },
    },
    {
      name: "chromium-unauth",
      testMatch: /app\.spec\.ts$/,
      grep: /\[RT-02\]/,
      use: { ...sharedChrome },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:5173",
    cwd: frontendRoot,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
