import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { api } from "@/platform/api/client";
import { dropPushSubscription, syncPushSubscription } from "./push";

const KEY = "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8";

function fakeBrowser(existing: unknown = null) {
  const sub = { endpoint: "https://fcm.googleapis.com/fcm/send/abc", toJSON: () => ({ endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: { p256dh: "k", auth: "a" } }), unsubscribe: vi.fn(() => Promise.resolve(true)) };
  const pushManager = { getSubscription: vi.fn(() => Promise.resolve(existing ?? null)), subscribe: vi.fn(() => Promise.resolve(sub)) };
  vi.stubGlobal("PushManager", function PushManager() {});
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { ready: Promise.resolve({ pushManager }) } });
  vi.stubGlobal("Notification", { permission: "granted" });
  return { sub, pushManager };
}

describe("push registration", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, "serviceWorker");
  });

  it("subscribes with the server key and sends the subscription", async () => {
    const { pushManager } = fakeBrowser();
    vi.spyOn(api, "get").mockResolvedValue({ public_key: KEY });
    const post = vi.spyOn(api, "post").mockResolvedValue({ message: "ok" });
    await syncPushSubscription();
    expect(pushManager.subscribe).toHaveBeenCalledWith(expect.objectContaining({ userVisibleOnly: true }));
    expect(post).toHaveBeenCalledWith("/api/v1/push/subscriptions", expect.objectContaining({ endpoint: "https://fcm.googleapis.com/fcm/send/abc" }));
  });

  it("does nothing without permission or when the server has no push key", async () => {
    const { pushManager } = fakeBrowser();
    vi.stubGlobal("Notification", { permission: "default" });
    const get = vi.spyOn(api, "get").mockResolvedValue({ public_key: KEY });
    await syncPushSubscription();
    expect(get).not.toHaveBeenCalled();
    vi.stubGlobal("Notification", { permission: "granted" });
    get.mockResolvedValue({ public_key: "" });
    await syncPushSubscription();
    expect(pushManager.subscribe).not.toHaveBeenCalled();
  });

  it("deletes the subscription on the server before dropping it in the browser", async () => {
    const { sub } = fakeBrowser();
    const order: string[] = [];
    const existing = { ...sub, unsubscribe: vi.fn(() => { order.push("unsubscribe"); return Promise.resolve(true); }) };
    fakeBrowser(existing);
    vi.spyOn(api, "delete").mockImplementation(() => { order.push("delete"); return Promise.resolve({ message: "ok" }); });
    await dropPushSubscription();
    expect(order).toEqual(["delete", "unsubscribe"]);
  });
});
