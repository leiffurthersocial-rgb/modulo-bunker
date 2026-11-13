import { defineConfig } from '@playwright/test';

const gpuArgs = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  reporter: [['list']],
  webServer: {
    command: 'npm run build && npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  use: { baseURL: 'http://localhost:4173', launchOptions: { args: gpuArgs } },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 } },
    // iPad Air 11" landscape-ish logical size, keyboard + trackpad (no touch).
    {
      name: 'ipad-keyboard',
      use: { viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2, hasTouch: false, isMobile: false },
    },
    // Same size, touch-only (on-screen controls path).
    {
      name: 'ipad-touch',
      use: {
        viewport: { width: 1180, height: 820 },
        deviceScaleFactor: 2,
        hasTouch: true,
        isMobile: true,
        userAgent:
          'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      },
    },
  ],
});
