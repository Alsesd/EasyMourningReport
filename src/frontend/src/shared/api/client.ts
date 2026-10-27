/**
 * Typed API Client for EasyMourningReport.
 * Handles same-origin requests, session cookies, CSRF guards, and structured errors.
 */

export class ApiError extends Error {
  status: number;
  data: unknown;

  constructor(message: string, status: number, data?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

interface RequestOptions extends Omit<RequestInit, "body"> {
  params?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { params, body, headers: customHeaders, ...rest } = options;

  let url = path;
  if (params) {
    const searchParams = new URLSearchParams();
    for (const [key, val] of Object.entries(params)) {
      if (val !== undefined && val !== null) {
        searchParams.set(key, String(val));
      }
    }
    const queryString = searchParams.toString();
    if (queryString) {
      url += (url.includes("?") ? "&" : "?") + queryString;
    }
  }

  const headers: Record<string, string> = {
    "X-Requested-With": "fetch",
    Accept: "application/json",
  };

  if (!(body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  if (customHeaders) {
    Object.assign(headers, customHeaders);
  }

  const response = await fetch(url, {
    ...rest,
    headers,
    credentials: "same-origin",
    body: body instanceof FormData ? body : body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
    let errorData: unknown = null;

    try {
      const json = await response.json();
      errorData = json;
      if (typeof json === "object" && json !== null) {
        if ("detail" in json && typeof json.detail === "string") {
          errorMessage = json.detail;
        } else if ("message" in json && typeof json.message === "string") {
          errorMessage = json.message;
        } else if ("errors" in json && Array.isArray(json.errors)) {
          errorMessage = json.errors.map((e: { msg?: string }) => e.msg || "").filter(Boolean).join("; ") || errorMessage;
        }
      }
    } catch {
      // Not JSON response
    }

    throw new ApiError(errorMessage, response.status, errorData);
  }

  if (response.status === 204) {
    return null as T;
  }

  return response.json() as Promise<T>;
}

export const api = {
  get: <T>(url: string, options?: RequestOptions) => request<T>(url, { ...options, method: "GET" }),
  post: <T>(url: string, body?: unknown, options?: RequestOptions) =>
    request<T>(url, { ...options, method: "POST", body }),
  put: <T>(url: string, body?: unknown, options?: RequestOptions) =>
    request<T>(url, { ...options, method: "PUT", body }),
  patch: <T>(url: string, body?: unknown, options?: RequestOptions) =>
    request<T>(url, { ...options, method: "PATCH", body }),
  delete: <T>(url: string, options?: RequestOptions) =>
    request<T>(url, { ...options, method: "DELETE" }),
  upload: <T>(url: string, formData: FormData, options?: RequestOptions) =>
    request<T>(url, { ...options, method: "POST", body: formData }),
};
