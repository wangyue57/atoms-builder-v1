import { defineConfig } from '@playwright/test';

const baseURL = process.env.LOCAL_WEB_URL ?? 'http://127.0.0.1:8790';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 180_000,
  // workspace.spec uses real PostgreSQL/API/Worker; interaction.spec intercepts every API for UI-only verification.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    browserName: 'chromium',
    channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome',
    viewport: { width: 1280, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: process.env.LOCAL_WEB_URL
    ? undefined
    : {
        command: 'npm start',
        url: `${baseURL}/healthz`,
        reuseExistingServer: false,
        env: {
          PORT: '8790',
          HOST: '127.0.0.1',
          APP_ORIGIN: baseURL,
          COOKIE_SECURE: 'false',
          WORKER_POLL_MS: '100',
          DATABASE_URL: process.env.DATABASE_URL,
          TEST_DATABASE_URL: process.env.TEST_DATABASE_URL,
          DSKEY: process.env.DSKEY,
          ...(process.env.DEEPSEEK_ENDPOINT ? { DEEPSEEK_ENDPOINT: process.env.DEEPSEEK_ENDPOINT } : {}),
        },
        timeout: 30_000,
        gracefulShutdown: { signal: 'SIGTERM', timeout: 6000 },
      },
});
