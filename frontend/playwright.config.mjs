import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  workers: 2,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL: "http://127.0.0.1:5180", browserName: "chromium", reducedMotion: "reduce", trace: "retain-on-failure" },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 5180 --strictPort",
    url: "http://127.0.0.1:5180", reuseExistingServer: false,
    env: { VITE_CHAIN_ID: "11155111", VITE_NETWORK_NAME: "Ethereum Sepolia", VITE_CONTRACT_ADDRESS: "0xC0ea3c8c97334955f02D357604346b32F8A4151E" }
  }
});
