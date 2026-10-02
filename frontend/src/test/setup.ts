import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import { resetCsrfToken } from "../api/client";

afterEach(() => {
  cleanup();
  localStorage.clear();
  resetCsrfToken();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
