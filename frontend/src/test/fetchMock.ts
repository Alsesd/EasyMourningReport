import { vi } from "vitest";

export interface Call {
  url: string;
  method: string;
  body: unknown;
}

/** Replaces fetch with a router: [method, url-substring] -> JSON answer (or a status/array pair). Returns the call log. */
export function mockFetch(routes: Record<string, unknown | [number, unknown]>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ url, method, body: typeof init?.body === "string" ? JSON.parse(init.body) : init?.body });
      const key = Object.keys(routes).find((k) => {
        const [m, part] = k.split(" ");
        return m === method && url.includes(part);
      });
      const hit = key ? routes[key] : undefined;
      const [status, data] = Array.isArray(hit) && typeof hit[0] === "number" ? (hit as [number, unknown]) : [key ? 200 : 404, hit ?? { detail: "Not Found" }];
      return Promise.resolve({ ok: status < 400, status, statusText: "x", json: () => Promise.resolve(data) });
    }),
  );
  return calls;
}
