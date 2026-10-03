import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import { resetCsrfToken } from "../api/client";

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
  document.documentElement.className = "";
  resetCsrfToken();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
