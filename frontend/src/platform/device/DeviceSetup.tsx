/**
 * After sign-in on a device that has not decided yet: one dialog that offers the two things the browser only does
 * after a tap, device notifications and installing the app. Each button calls the browser directly from its click
 * (no await before the call), and the two are never chained on one click. "Later" asks again after a week.
 */

import { useEffect, useState, useSyncExternalStore } from "react";
import { Bell, Download, Share } from "lucide-react";
import { useAuth } from "@/platform/auth/AuthContext";
import { ukPlatform as uk } from "@/platform/i18n";
import { useDialogSlot } from "@/platform/device/dialogSlot";
import { canPromptInstall, isIosTab, isStandalone, promptInstall, subscribeInstall } from "@/platform/device/installPrompt";
import { notificationPermission, notificationsSupported } from "@/platform/device/notify";
import { Button } from "@/ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/ui/Dialog";

const t = uk.device;
const LATER_KEY = "legkyi.deviceSetupLater";
const WEEK_MS = 7 * 24 * 3600 * 1000;

const laterActive = (): boolean => {
  try {
    const v = Number(window.localStorage.getItem(LATER_KEY));
    return v > 0 && Date.now() - v < WEEK_MS;
  } catch {
    return false;
  }
};
const setLater = () => {
  try {
    window.localStorage.setItem(LATER_KEY, String(Date.now()));
  } catch {
    /* storage blocked: the dialog may come back on the next sign-in */
  }
};

/** Called after the person allowed notifications, so the server can reach this device while the app is closed. */
export type OnAllowed = () => void;

export function DeviceSetup({ onNotificationsAllowed }: { onNotificationsAllowed?: OnAllowed }) {
  const { isAuthenticated } = useAuth();
  const installable = useSyncExternalStore(subscribeInstall, canPromptInstall, () => false);
  const [permission, setPermission] = useState(notificationPermission);
  const [skipped, setSkipped] = useState(laterActive);
  const [installed, setInstalled] = useState(isStandalone);

  useEffect(() => {
    const done = () => setInstalled(true);
    window.addEventListener("appinstalled", done);
    return () => window.removeEventListener("appinstalled", done);
  }, []);

  const needNotifications = notificationsSupported() && permission === "default";
  const needInstall = !installed && (installable || isIosTab());
  const want = isAuthenticated && !skipped && (needNotifications || needInstall);
  const open = useDialogSlot(want);

  const enable = async () => {
    // Directly from the click: browsers (iPhone above all) ignore a request that is not.
    const result = await Notification.requestPermission();
    setPermission(result);
    if (result === "granted") onNotificationsAllowed?.();
  };
  const install = async () => {
    const outcome = await promptInstall();
    if (outcome === "accepted") setInstalled(true);
  };
  const later = () => {
    setLater();
    setSkipped(true);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && later()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription>{t.text}</DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          {needNotifications && (
            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-text-main">{t.notificationsTitle}</h3>
              <p className="text-sm text-text-muted">{t.notificationsText}</p>
              <Button variant="primary" onClick={() => void enable()}>
                <Bell className="mr-2 h-4 w-4" aria-hidden="true" />
                {t.enableNotifications}
              </Button>
            </section>
          )}
          {needInstall && (
            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-text-main">{t.installTitle}</h3>
              <p className="text-sm text-text-muted">{installable ? t.installText : t.installIos}</p>
              {installable ? (
                <Button variant={needNotifications ? "outline" : "primary"} onClick={() => void install()}>
                  <Download className="mr-2 h-4 w-4" aria-hidden="true" />
                  {t.installApp}
                </Button>
              ) : (
                <p className="flex items-center gap-2 text-sm font-medium text-text-main">
                  <Share className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {t.installIosSteps}
                </p>
              )}
            </section>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={later}>
            {t.later}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
