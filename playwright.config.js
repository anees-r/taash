/** End-to-end tests run against a production build with TAASH_E2E=1 (short test deals, card sheet). */
import { defineConfig } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT || 3100);
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 240_000,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    ...(process.env.PW_CHROMIUM ? { launchOptions: { executablePath: process.env.PW_CHROMIUM } } : {}),
  },
  webServer: {
    command: 'node server.js',
    url: `http://localhost:${PORT}/healthz`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { NODE_ENV: 'production', PORT: String(PORT), TAASH_E2E: '1', APP_URL: `http://localhost:${PORT}`, AUTH_URL: `http://localhost:${PORT}`, LOG_LEVEL: 'warn' },
  },
});
