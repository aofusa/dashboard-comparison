// CommonJS: Playwright が TS 設定を CJS 経由で読む際の `exports is not defined` を避ける
const path = require("node:path");
const { defineConfig, devices } = require("@playwright/test");

const here = __dirname;
const frontendRoot = path.join(here, "../..");
const authFile = path.join(here, ".auth", "dev.json");
/** auth.setup.ts で `import.meta` を使わず CJS 互換にする */
process.env.PW_E2E_AUTH_FILE = authFile;

/** `next dev` が `frontendRoot` の `.env` を読む。親シェルで `DATABASE_URL` 等を export してもよい。 */

const sharedChrome = { ...devices["Desktop Chrome"] };

module.exports = defineConfig({
  testDir: here,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 30_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    // AUTH_URL / NEXTAUTH_URL と同一ホストにすること（127.0.0.1 と localhost 混在で CSRF が欠落しうる）
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
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
    url: "http://localhost:3000",
    cwd: frontendRoot,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env },
  },
});
