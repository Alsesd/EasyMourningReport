/**
 * The bell: unread count on the button, a list in a panel anchored to the button (a bottom sheet on phones), refreshed on its own every 20 s (only this element
 * re-renders). While the page is open it can also raise a device notification for each new message once the
 * person has allowed it in the browser. A closed app cannot be reached this way (that would need Web Push).
 */

import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, BellRing } from "lucide-react";
import { formatDateTime, ukPlatform as uk } from "@/platform/i18n";
import type { NotificationsDTO } from "@/platform/api/types";
import { notificationsApi } from "@/platform/notifications/api";
import { notificationPermission, showDeviceNotification } from "@/platform/device/notify";
import { Button } from "@/ui/Button";
import { Switch } from "@/ui/Switch";
import { AnchoredPanel } from "@/ui/Popover";
import { cn } from "@/ui/utils";

const t = uk.notifications;
const REFRESH_MS = 20000;

export function NotificationBell({ className }: { className?: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [permission, setPermission] = useState(notificationPermission);
  const { data } = useQuery({
    queryKey: ["notifications"],
    queryFn: notificationsApi.list,
    refetchInterval: REFRESH_MS,
    retry: false,
  });
  const set = (next: NotificationsDTO) => queryClient.setQueryData(["notifications"], next);
  const read = useMutation({ mutationFn: (id: number) => notificationsApi.read(id), onSuccess: set });
  const [testResult, setTestResult] = useState<string | null>(null);
  const sendTest = useMutation({
    mutationFn: () => notificationsApi.test(),
    onSuccess: (r) => {
      setTestResult(r.push_configured ? t.testSent(r.devices) : t.testNoPush);
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
    onError: (err: Error) => setTestResult(err.message),
  });
  const readAll = useMutation({ mutationFn: () => notificationsApi.readAll(), onSuccess: set });

  // Device notifications for messages that arrive while the page is open. The first answer only sets the
  // baseline, so what was already waiting is not announced again after every page load.
  const lastSeen = useRef<number | null>(null);
  useEffect(() => {
    const items = data?.items;
    if (!items) return;
    const newest = items.reduce((m, n) => Math.max(m, n.id), 0);
    if (lastSeen.current !== null && permission === "granted") {
      for (const n of items) {
        if (n.id > lastSeen.current && !n.read) {
          void showDeviceNotification(n.id, n.title, n.body, n.link);
        }
      }
    }
    lastSeen.current = Math.max(lastSeen.current ?? 0, newest);
  }, [data, permission]);

  const items = data?.items ?? [];
  const unread = data?.unread ?? 0;

  const enableDevice = async () => {
    try {
      setPermission(await Notification.requestPermission());
    } catch {
      setPermission("denied");
    }
  };

  return (
    <AnchoredPanel
      open={open}
      onOpenChange={setOpen}
      title={t.title}
      trigger={
        <button
          type="button"
          aria-label={t.bell(unread)}
          title={t.title}
          className={cn(
            "relative grid h-11 w-11 shrink-0 place-items-center rounded-control text-text-muted transition-colors hover:bg-surface-raised hover:text-text-main focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
            className,
          )}
        >
          {unread > 0 ? <BellRing className="h-5 w-5 text-primary" strokeWidth={1.8} aria-hidden="true" /> : <Bell className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />}
          {unread > 0 && (
            <span
              aria-hidden="true"
              className="figure absolute right-0.5 top-0.5 grid min-h-[18px] min-w-[18px] place-items-center rounded-full bg-attention px-1 text-[0.6875rem] font-semibold leading-none text-white"
            >
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </button>
      }
    >
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-1.5">
        <span className="text-sm text-text-muted">{unread > 0 ? t.unreadCount(unread) : t.allRead}</span>
        <Button type="button" variant="ghost" size="sm" disabled={unread === 0 || readAll.isPending} onClick={() => readAll.mutate()}>
          {t.markAll}
        </Button>
      </div>
      <ul className="min-h-0 max-h-[50dvh] divide-y divide-border overflow-y-auto overscroll-contain sm:max-h-none sm:flex-1">
        {items.length === 0 ? (
          <li className="px-4 py-8 text-center text-sm text-text-muted">{t.empty}</li>
        ) : (
          items.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                className="block min-h-[44px] w-full px-4 py-3 text-left transition-colors hover:bg-surface-raised focus-visible:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                onClick={() => {
                  if (!n.read) read.mutate(n.id);
                  setOpen(false);
                  if (n.link) navigate(n.link);
                }}
              >
                <span className={cn("block text-[0.9375rem] leading-snug text-text-main", !n.read && "font-semibold")}>
                  {!n.read && <span aria-hidden="true" className="mr-2 inline-block h-2 w-2 rounded-full bg-attention align-middle" />}
                  {n.title}
                  {!n.read && <span className="sr-only"> ({t.unread})</span>}
                </span>
                {n.body && <span className="mt-0.5 block break-words text-sm text-text-muted">{n.body}</span>}
                <span className="figure mt-1 block text-xs text-text-muted">{formatDateTime(n.created_at)}</span>
              </button>
            </li>
          ))
        )}
      </ul>
      <div className="space-y-3 border-t border-border bg-surface-raised px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium text-text-main">{t.enableDevice}</span>
          <Switch
            label={t.enableDevice}
            checked={permission === "granted"}
            disabled={permission !== "default"}
            onChange={() => void enableDevice()}
            onText={uk.system.on}
            offText={uk.system.off}
          />
        </div>
        <p className="text-xs leading-snug text-text-muted">
          {permission === "default" && t.deviceHint}
          {permission === "granted" && t.deviceOn}
          {permission === "denied" && t.deviceDenied}
        </p>
        <Button type="button" variant="outline" size="sm" className="w-full sm:w-auto" disabled={sendTest.isPending} onClick={() => sendTest.mutate()}>
          {sendTest.isPending ? t.sendingTest : t.sendTest}
        </Button>
        {testResult && (
          <p role="status" className="text-xs text-text-main">
            {testResult}
          </p>
        )}
      </div>
    </AnchoredPanel>
  );
}
