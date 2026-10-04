import type { Location } from "react-router-dom";

/** Where to go after signing in: the page the user was sent away from, else the dashboard. */
export function returnPath(state: unknown): string {
  const from = (state as { from?: Partial<Location> } | null)?.from;
  const path = typeof from?.pathname === "string" ? from.pathname : "/";
  if (!path.startsWith("/") || path.startsWith("//") || path === "/login" || path === "/signup") return "/";
  return `${path}${from?.search ?? ""}`;
}
