import { vi } from "vitest";

/** A handler returns a JSON body, a `reply(...)` for a non-200 status, or throws to simulate no network. */
type Handler = (body: unknown, url: URL) => unknown;

class MockReply {
  constructor(readonly status: number, readonly body: unknown) {}
}

export const reply = (status: number, body: unknown) => new MockReply(status, body);

/** Who /api/auth/me says is signed in, unless a test mocks it. */
export const TEST_USER = {
  id: 1, email: "cook@example.com", display_name: "Test Cook", initials: "TC", is_demo: false,
  created_at: "2026-10-01 09:00:00",
};

export function networkDown(): never {
  throw new TypeError("Failed to fetch");
}

export interface Call {
  method: string;
  path: string;
  body: unknown;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/**
 * Stub global fetch. Routes are keyed "METHOD /path?query" (exact) or "METHOD /path".
 * /api/csrf, /api/config and /api/auth/me (signed in as TEST_USER) answer by default.
 */
export function mockApi(routes: Record<string, Handler | object>) {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : (init?.body ?? null);
    calls.push({ method, path: url.pathname + url.search, body });

    const handler =
      routes[`${method} ${url.pathname}${url.search}`] ??
      routes[`${method} ${url.pathname}`] ??
      (url.pathname === "/api/csrf" ? { token: "test-token" } : undefined) ??
      (url.pathname === "/api/auth/me" ? { user: TEST_USER, csrf_token: "test-token" } : undefined) ??
      (url.pathname === "/api/config" ? { allow_signups: true, demo_login: false, ai_enabled: false, categories: ["Breakfast", "Lunch", "Dinner", "Dessert"],
        days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
        multipliers: [1, 2, 3, 4], max_image_bytes: 5242880 } : undefined);
    if (handler === undefined) return json({ error: `No mock for ${method} ${url.pathname}` }, 404);
    const result = typeof handler === "function" ? await (handler as Handler)(body, url) : handler;
    return result instanceof MockReply ? json(result.body, result.status) : json(result);
  });
  vi.stubGlobal("fetch", fetchMock);
  return {
    calls,
    fetchMock,
    callsTo: (method: string, path: string) => calls.filter((c) => c.method === method && c.path === path),
  };
}
