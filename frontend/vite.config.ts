import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  build: { manifest: true },
  plugins: [react()],
  test: {
    include: ["src/test/**/*.test.{ts,tsx}"],
    // Unit fixtures stay deterministic regardless of the developer's .env.local.
    env: {
      VITE_CHAIN_ID: "31337",
      VITE_NETWORK_NAME: "Anvil Local",
      VITE_CONTRACT_ADDRESS: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
    },
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    clearMocks: true,
    restoreMocks: true,
    testTimeout: 10_000,
  },
  server: {
    watch: {
      usePolling: true,
      interval: 1000,
    },
  },
});
