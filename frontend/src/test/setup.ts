import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
  delete window.ethereum;
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
