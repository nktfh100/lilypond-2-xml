import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './test/browser',
  timeout: 120000,
  use: {
    baseURL: 'http://127.0.0.1:4176',
    launchOptions: process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {},
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npx vite preview --host 127.0.0.1 --port 4176 --strictPort',
    url: 'http://127.0.0.1:4176/test/browser/browser.html',
  },
});
