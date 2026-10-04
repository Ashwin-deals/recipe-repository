import { describe, expect, it } from "vitest";
import { mockApi, reply } from "../test/mockApi";
import { api, ApiError } from "./client";

describe("api client", () => {
  it("sends the CSRF token on writes and retries once after a 403", async () => {
    let first = true;
    const mock = mockApi({
      "POST /api/list/clear": () => {
        if (first) {
          first = false;
          return reply(403, { error: "Your session expired.", code: "csrf" });
        }
        return { removed: 0 };
      },
    });
    await expect(api.post("/api/list/clear", { scope: "all" })).resolves.toEqual({ removed: 0 });
    const posts = mock.fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(posts).toHaveLength(2);
    for (const [, init] of posts) expect((init?.headers as Record<string, string>)["X-CSRF-Token"]).toBe("test-token");
    expect(mock.callsTo("GET", "/api/csrf")).toHaveLength(2);
  });

  it("turns error responses into ApiError with field messages", async () => {
    mockApi({ "POST /api/recipes": reply(400, { error: "Please fix it.", fields: { title: "Required", bad: 3 } }) });
    const error = await api.post("/api/recipes", {}).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ message: "Please fix it.", status: 400, fields: { title: "Required" } });
  });

  it("reports network failures as offline", async () => {
    mockApi({
      "GET /api/list": () => {
        throw new TypeError("Failed to fetch");
      },
    });
    const error = await api.get("/api/list").catch((err: unknown) => err);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).offline).toBe(true);
  });
});
