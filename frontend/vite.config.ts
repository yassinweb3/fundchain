import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
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
