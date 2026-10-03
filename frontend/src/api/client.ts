// Small typed fetch wrapper. All URLs are relative (/api/...), so production needs no CORS
// and the Vite dev server proxies them to Flask.

export class ApiError extends Error {
  readonly status: number;
  readonly fields: Record<string, string>;

  constructor(message: string, status: number, fields: Record<string, string> = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.fields = fields;
  }

  /** True when the request never reached the server (no signal, server down). */
  get offline(): boolean {
    return this.status === 0;
  }
}

type Method = "GET" | "POST" | "PUT" | "DELETE";

interface RequestOptions {
  method?: Method;
  json?: unknown;
  form?: FormData;
}

let csrfToken: string | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorFrom(data: unknown, status: number): ApiError {
  const message = isRecord(data) && typeof data.error === "string" ? data.error : `Something went wrong (${status}).`;
  const fields: Record<string, string> = {};
  if (isRecord(data) && isRecord(data.fields)) {
    for (const [key, value] of Object.entries(data.fields)) {
      if (typeof value === "string") fields[key] = value;
    }
  }
  return new ApiError(message, status, fields);
}

async function getCsrfToken(): Promise<string> {
  if (csrfToken === null) {
    const data = await request<{ token: string }>("/api/csrf");
    csrfToken = data.token;
  }
  return csrfToken;
}

async function request<T>(path: string, options: RequestOptions = {}, retried = false): Promise<T> {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = { Accept: "application/json" };
  let body: BodyInit | undefined;
  if (method !== "GET") headers["X-CSRF-Token"] = await getCsrfToken();
  if (options.form) {
    body = options.form;
  } else if (options.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.json);
  }

  let response: Response;
  try {
    response = await fetch(path, { method, headers, body, credentials: "same-origin" });
  } catch {
    throw new ApiError("You're offline. Check your connection and try again.", 0);
  }

  // 403 means the session (and its CSRF token) expired: fetch a fresh token and retry once.
  if (response.status === 403 && method !== "GET" && !retried) {
    csrfToken = null;
    return request<T>(path, options, true);
  }

  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) throw errorFrom(data, response.status);
  // The backend is the source of truth for these shapes (see types/index.ts).
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, json: unknown = {}) => request<T>(path, { method: "POST", json }),
  put: <T>(path: string, json: unknown) => request<T>(path, { method: "PUT", json }),
  postForm: <T>(path: string, form: FormData) => request<T>(path, { method: "POST", form }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

/** Test helper: forget the cached CSRF token between tests. */
export function resetCsrfToken(): void {
  csrfToken = null;
}
