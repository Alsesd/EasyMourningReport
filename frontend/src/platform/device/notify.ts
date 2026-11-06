/** Device (system) notifications. They go through the service worker: `new Notification()` throws on Android Chrome. */

export function notificationsSupported(): boolean {
  try {
    return typeof Notification !== "undefined";
  } catch {
    return false;
  }
}

export function notificationPermission(): NotificationPermission | "unsupported" {
  return notificationsSupported() ? Notification.permission : "unsupported";
}

/** The same tag is used by the push path (sw.js), so a notification is never shown twice for one message. */
export async function showDeviceNotification(id: number, title: string, body: string, link: string): Promise<void> {
  const options: NotificationOptions = { body, tag: `legkyi-${id}`, data: { link, id }, icon: "/static/icon-192.png" };
  try {
    if ("serviceWorker" in navigator) {
      const reg = await Promise.race([navigator.serviceWorker.ready, new Promise<undefined>((r) => setTimeout(r, 1500))]);
      if (reg) {
        await reg.showNotification(title, options);
        return;
      }
    }
    new Notification(title, options);
  } catch {
    /* no way to show it on this browser */
  }
}
