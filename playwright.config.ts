import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  workers: 1,
  timeout: 60000,
  use: { browserName: 'chromium', channel: 'msedge', baseURL: 'http://127.0.0.1:1421' },
  webServer: {
    command: 'npm run preview -- --port 1421 --strictPort',
    url: 'http://127.0.0.1:1421',
    reuseExistingServer: true,
  },
  reporter: 'list',
});
