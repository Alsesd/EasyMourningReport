/**
 * The bell: unread count on the button, a list in a dialog, refreshed on its own every 20 s (only this element
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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/ui/Dialog";
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
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t.bell(unread)}
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

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t.title}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" disabled={unread === 0 || readAll.isPending} onClick={() => readAll.mutate()}>
              {t.markAll}
            </Button>
            {permission === "default" && (
              <Button type="button" variant="ghost" size="sm" onClick={() => void enableDevice()}>
                {t.enableDevice}
              </Button>
            )}
          </div>
          {permission === "default" && <p className="text-xs text-text-muted">{t.deviceHint}</p>}
          {permission === "granted" && <p className="text-xs text-text-muted">{t.deviceOn}</p>}
          {permission === "denied" && <p className="text-xs text-text-muted">{t.deviceDenied}</p>}
          <ul className="-mx-1 max-h-[60vh] divide-y divide-border overflow-y-auto">
            {items.length === 0 ? (
              <li className="px-1 py-6 text-sm text-text-muted">{t.empty}</li>
            ) : (
              items.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    className="block min-h-[44px] w-full px-1 py-3 text-left hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    onClick={() => {
                      if (!n.read) read.mutate(n.id);
                      setOpen(false);
                      if (n.link) navigate(n.link);
                    }}
                  >
                    <span className={cn("block text-[0.9375rem] text-text-main", !n.read && "font-semibold")}>
                      {!n.read && <span aria-hidden="true" className="mr-2 inline-block h-2 w-2 rounded-full bg-attention align-middle" />}
                      {n.title}
                      {!n.read && <span className="sr-only"> ({t.unread})</span>}
                    </span>
                    {n.body && <span className="block break-words text-sm text-text-muted">{n.body}</span>}
                    <span className="figure block text-xs text-text-muted">{formatDateTime(n.created_at)}</span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </DialogContent>
      </Dialog>
    </>
  );
}
