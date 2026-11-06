/**
 * Web Push registration. With notifications allowed, the browser hands the page a subscription; the server keeps it
 * and sends messages to it even when the app is closed. The subscription belongs to whoever is signed in: it is
 * re-sent on every signed-in load (browsers rotate them) and deleted before signing out, so the next person on a
 * shared device never receives the previous person's messages.
 */

import { api } from "@/platform/api/client";
import type { MessageDTO, PushKeyDTO } from "@/platform/api/types";
import { notificationPermission } from "@/platform/device/notify";

export function pushSupported(): boolean {
  return typeof navigator !== "undefined" && "serviceWorker" in navigator && typeof window !== "undefined" && "PushManager" in window;
}

function keyBytes(base64url: string): Uint8Array {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  // Development builds register no service worker: do not wait for one.
  const reg = await Promise.race([navigator.serviceWorker.ready, new Promise<null>((r) => setTimeout(() => r(null), 2000))]);
  return reg ?? null;
}

/** Subscribes this browser (when allowed and configured on the server) and tells the server. Safe to repeat. */
export async function syncPushSubscription(): Promise<void> {
  if (!pushSupported() || notificationPermission() !== "granted") return;
  const { public_key } = await api.get<PushKeyDTO>("/api/v1/push/key");
  if (!public_key) return;
  const reg = await registration();
  if (!reg) return;
  const options = { userVisibleOnly: true, applicationServerKey: keyBytes(public_key) as BufferSource };
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe(options);
  }
  try {
    await api.post<MessageDTO>("/api/v1/push/subscriptions", sub.toJSON());
  } catch (err) {
    // A subscription made against another server key is useless: start again with the current one.
    await sub.unsubscribe();
    sub = await reg.pushManager.subscribe(options);
    await api.post<MessageDTO>("/api/v1/push/subscriptions", sub.toJSON());
    void err;
  }
}

/** Forgets this browser on the server and in the browser. Call before signing out. */
export async function dropPushSubscription(): Promise<void> {
  if (!pushSupported()) return;
  const reg = await registration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  try {
    await api.delete<MessageDTO>(`/api/v1/push/subscriptions?endpoint=${encodeURIComponent(sub.endpoint)}`);
  } finally {
    await sub.unsubscribe().catch(() => false);
  }
}
