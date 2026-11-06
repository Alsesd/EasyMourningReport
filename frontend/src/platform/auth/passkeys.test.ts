import { describe, it, expect, afterEach, vi } from "vitest";
import { passkeyApi, passkeysSupported } from "./passkeys";
import { mockFetch } from "@/test/fetchMock";

const b64 = (s: string) => btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const buf = (s: string) => new TextEncoder().encode(s).buffer;

describe("passkey helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("needs a secure context and the WebAuthn API", () => {
    vi.stubGlobal("isSecureContext", false);
    expect(passkeysSupported()).toBe(false);
    vi.stubGlobal("isSecureContext", true);
    vi.stubGlobal("PublicKeyCredential", function () {});
    expect(passkeysSupported()).toBe(true);
  });

  it("registers: converts the options for the browser and posts the signed result", async () => {
    const calls = mockFetch({
      "POST /api/v1/passkeys/options": { challenge_id: "c1", public_key: { challenge: b64("chal"), user: { id: b64("u"), name: "x" }, excludeCredentials: [{ id: b64("old"), type: "public-key" }], rp: { id: "h" } } },
      "POST /api/v1/passkeys": { message: "ok" },
    });
    const create = vi.fn(() => Promise.resolve({ id: "cred", response: { clientDataJSON: buf("cd"), attestationObject: buf("att") } }));
    vi.stubGlobal("navigator", { credentials: { create } });
    await passkeyApi.register("Телефон");
    const arg = (create.mock.calls[0] as unknown as [{ publicKey: { challenge: ArrayBuffer; excludeCredentials: { id: ArrayBuffer }[] } }])[0].publicKey;
    expect(new TextDecoder().decode(arg.challenge)).toBe("chal");
    expect(new TextDecoder().decode(arg.excludeCredentials[0].id)).toBe("old");
    expect(calls[1].body).toMatchObject({ challenge_id: "c1", name: "Телефон", id: "cred", client_data_json: b64("cd"), attestation_object: b64("att") });
  });

  it("signs in with a discoverable credential", async () => {
    const calls = mockFetch({
      "POST /api/v1/auth/passkey/options": { challenge_id: "c2", public_key: { challenge: b64("c"), rpId: "h", allowCredentials: [] } },
      "POST /api/v1/auth/passkey": { login: "boss" },
    });
    const get = vi.fn(() => Promise.resolve({ id: "cred", response: { clientDataJSON: buf("cd"), authenticatorData: buf("ad"), signature: buf("sg") } }));
    vi.stubGlobal("navigator", { credentials: { get } });
    expect(await passkeyApi.login()).toEqual({ login: "boss" });
    expect(calls[1].body).toMatchObject({ challenge_id: "c2", id: "cred", authenticator_data: b64("ad"), signature: b64("sg") });
  });

  it("reports a cancelled prompt as NotAllowedError", async () => {
    mockFetch({
      "POST /api/v1/auth/passkey/options": { challenge_id: "c", public_key: { challenge: b64("c") } },
      "POST /api/v1/passkeys/options": { challenge_id: "c", public_key: { challenge: b64("c"), user: { id: b64("u") } } },
    });
    vi.stubGlobal("navigator", { credentials: { get: () => Promise.resolve(null), create: () => Promise.resolve(null) } });
    await expect(passkeyApi.login()).rejects.toMatchObject({ name: "NotAllowedError" });
    await expect(passkeyApi.register("x")).rejects.toMatchObject({ name: "NotAllowedError" });
  });

  it("lists and removes", async () => {
    const calls = mockFetch({ "GET /api/v1/passkeys": [], "DELETE /api/v1/passkeys/4": { message: "ok" } });
    await passkeyApi.list();
    await passkeyApi.remove(4);
    expect(calls.map((c) => c.method)).toEqual(["GET", "DELETE"]);
  });
});
