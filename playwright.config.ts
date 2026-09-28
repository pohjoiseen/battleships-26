import { defineConfig, devices } from '@playwright/test';

const port = 3200;

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  fullyParallel: true,
  use: { baseURL: `http://127.0.0.1:${port}`, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // Built client served by the real server; animations and AI pacing sped up 20x.
    command: `npm run build && PORT=${port} BS_TIME_SCALE=0.05 BS_SEED=1 npm start`,
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
