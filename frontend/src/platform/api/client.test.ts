import { describe, it, expect, afterEach, vi } from "vitest";
import { api, ApiError } from "./client";
import { mockFetch } from "@/test/fetchMock";

describe("api client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends JSON with the same-origin headers and builds the query string", async () => {
    const calls = mockFetch({ "GET /x": { ok: 1 }, "POST /x": { ok: 2 }, "PUT /x": { ok: 3 }, "PATCH /x": { ok: 4 }, "DELETE /x": { ok: 5 } });
    expect(await api.get("/x", { params: { a: 1, b: undefined, c: null, d: "z" } })).toEqual({ ok: 1 });
    expect(calls[0].url).toBe("/x?a=1&d=z");
    expect(await api.get("/x?q=1", { params: { a: 2 } })).toEqual({ ok: 1 });
    expect(calls[1].url).toBe("/x?q=1&a=2");
    expect(await api.post("/x", { n: 1 })).toEqual({ ok: 2 });
    expect(await api.put("/x", { n: 1 })).toEqual({ ok: 3 });
    expect(await api.patch("/x", { n: 1 })).toEqual({ ok: 4 });
    expect(await api.delete("/x")).toEqual({ ok: 5 });
    expect(calls[2].body).toEqual({ n: 1 });
    const fd = new FormData();
    await api.upload("/x", fd);
    expect(calls.at(-1)?.body).toBe(fd);
    const init = vi.mocked(globalThis.fetch).mock.calls[2][1] as RequestInit;
    expect((init.headers as Record<string, string>)["X-Requested-With"]).toBe("fetch");
  });

  it("turns every error shape into an ApiError with a readable message", async () => {
    mockFetch({
      "GET /detail": [409, { detail: "Конфлікт" }],
      "GET /message": [400, { message: "Повідомлення" }],
      "GET /errors": [422, { errors: [{ msg: "A" }, { msg: "" }, { msg: "B" }] }],
      "GET /empty-errors": [422, { errors: [] }],
      "GET /html": [500, "<html>"],
    });
    await expect(api.get("/detail")).rejects.toMatchObject({ status: 409, message: "Конфлікт" });
    await expect(api.get("/message")).rejects.toMatchObject({ message: "Повідомлення" });
    await expect(api.get("/errors")).rejects.toMatchObject({ message: "A; B" });
    await expect(api.get("/empty-errors")).rejects.toBeInstanceOf(ApiError);
    await expect(api.get("/html")).rejects.toMatchObject({ status: 500 });
  });

  it("returns null for 204 and survives a non-JSON error body", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true, status: 204, json: () => Promise.reject(new Error("no body")) })));
    expect(await api.get("/none")).toBeNull();
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: false, status: 502, statusText: "Bad Gateway", json: () => Promise.reject(new Error("not json")) })));
    await expect(api.get("/bad")).rejects.toMatchObject({ status: 502, message: "HTTP 502: Bad Gateway" });
  });
});
