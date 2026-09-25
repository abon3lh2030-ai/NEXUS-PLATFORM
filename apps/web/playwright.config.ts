import { defineConfig, devices } from '@playwright/test';

/**
 * Two suites:
 *  - ui-smoke:  builds the web app and runs against `vite preview` (API calls are mocked per test).
 *  - files-api: end-to-end company-files security flow against a REAL API + Supabase project.
 *               Runs only when E2E_API_URL, SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are set.
 */
const PORT = 4317;

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  reporter: [['list']],
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: 'retain-on-failure' },
  projects: [
    { name: 'ui-smoke', testMatch: /ui-smoke\.spec\.ts/, use: { ...devices['Desktop Chrome'] } },
    { name: 'ui-mobile', testMatch: /ui-smoke\.spec\.ts/, use: { ...devices['Pixel 7'] } },
    { name: 'files-api', testMatch: /files-api\.spec\.ts/ },
  ],
  webServer: {
    command: `npx vite build --mode e2e && npx vite preview --host 127.0.0.1 --port ${PORT} --strictPort --mode e2e`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
      VITE_SUPABASE_ANON_KEY: 'e2e-anon-key-not-a-secret',
      VITE_API_BASE_URL: 'http://127.0.0.1:9',
      VITE_PUBLIC_APP_URL: `http://127.0.0.1:${PORT}`,
    },
  },
});
