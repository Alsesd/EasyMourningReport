/**
 * The «Продукція» tab. A desk sees its own requests of a day and makes new ones; the dispatcher sees every desk's
 * requests of the day and loads them onto cars or turns them down.
 */

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { transportApi } from "@/modules/transport/api";
import { RequestCard } from "@/modules/transport/components/RequestCard";
import { RequestForm } from "@/modules/transport/components/RequestForm";
import { useDispatchDialogs } from "@/modules/transport/components/DispatchDialogs";
import { POLL_MS, useToday } from "@/modules/transport/hooks";
import { transportError } from "@/modules/transport/errors";
import { uk } from "@/modules/transport/i18n";
import { TP } from "@/modules/transport/permissions";
import { useAuth } from "@/platform/auth/AuthContext";
import type { ProductRequest } from "@/modules/transport/types";
import { Button } from "@/ui/Button";
import { useConfirm } from "@/ui/ConfirmDialog";
import { DayPicker } from "@/ui/DayPicker";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/ui/Dialog";
import { LedgerSection } from "@/ui/LedgerSection";
import { Notice, type NoticeMessage } from "@/ui/Notice";
import { formatDayReadable } from "@/modules/transport/i18n";

const t = uk.transport;
const dayLabels = { previous: t.previousDay, next: t.nextDay, day: t.dayLabel, today: t.today };

export function ProductsPanel() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const desk = can(TP.create);
  const manage = can(TP.manage);
  const staff = can(TP.manage, TP.viewAll);
  const today = useToday();
  const [picked, setPicked] = useState<string | null>(null);
  const day = picked ?? today;
  const [message, setMessage] = useState<NoticeMessage | null>(null);
  const [editing, setEditing] = useState<ProductRequest | "new" | null>(null);
  const { ask, dialog: confirmDialog } = useConfirm(uk.common.cancel);
  const notify = (text: string) => setMessage({ text, kind: "ok" });

  const requests = useQuery({ queryKey: ["transport", "requests", { day }], queryFn: () => transportApi.requests({ date: day }), refetchInterval: POLL_MS });
  const open = useQuery({ queryKey: ["transport", "requests", "open", { day }], queryFn: () => transportApi.requests({ date: day, open: true }), enabled: manage });
  const fleet = useQuery({ queryKey: ["transport", "cars"], queryFn: () => transportApi.cars(), enabled: manage, staleTime: 60_000 });
  const dispatch = useDispatchDialogs({ day, cars: fleet.data?.items ?? [], openRequests: open.data ?? [], notify });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["transport"] });

  const cancel = (r: ProductRequest) =>
    ask({
      title: t.requestCancel,
      description: `${t.requestCancelConfirm} ${formatDayReadable(r.need_date)}.`,
      actionLabel: t.requestCancel,
      onConfirm: async () => {
        try {
          await transportApi.cancelRequest(r.id);
          notify(t.requestCancelled);
        } catch (err) {
          setMessage({ text: transportError(err), kind: "err" });
        }
        void refresh();
      },
    });

  const list = requests.data ?? [];
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-prose text-sm text-text-muted">{staff && !desk ? t.productsHintStaff : t.productsHintDesk}</p>
        {desk && (
          <Button type="button" onClick={() => setEditing("new")}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t.newRequest}
          </Button>
        )}
      </div>
      <Notice message={message} onDismiss={() => setMessage(null)} dismissLabel={uk.common.close} />
      <div className="flex flex-wrap items-center gap-3">
        <DayPicker value={day} onChange={setPicked} labels={dayLabels} className="w-full sm:w-auto sm:max-w-md sm:flex-1" />
      </div>

      <LedgerSection id="requests" title={staff && !desk ? t.requestsDay : t.requestsMine} description={requests.isError ? (requests.error as Error).message : formatDayReadable(day)}>
        {requests.isLoading ? (
          <div className="space-y-3 px-1 py-4" aria-busy="true">
            <p className="text-sm text-text-muted">{uk.common.loading}</p>
            <div className="h-20 animate-pulse rounded-control bg-surface-raised motion-reduce:animate-none" aria-hidden="true" />
          </div>
        ) : list.length === 0 ? (
          <p className="px-1 py-6 text-sm text-text-muted">{desk && !staff ? t.requestsEmptyDesk : t.requestsEmpty}</p>
        ) : (
          list.map((r) => (
            <RequestCard
              key={r.id}
              request={r}
              showOrganisation={staff}
              onEdit={desk && !staff ? setEditing : undefined}
              onCancel={desk && !staff ? cancel : undefined}
              onAddToRun={manage ? dispatch.addToRun : undefined}
              onReject={manage ? dispatch.reject : undefined}
            />
          ))
        )}
      </LedgerSection>
      {manage && (
        <div>
          <Button type="button" variant="outline" onClick={() => dispatch.newRun()}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t.newRun}
          </Button>
        </div>
      )}

      {confirmDialog}
      {dispatch.dialogs}

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editing === "new" ? t.newRequest : t.editRequest}</DialogTitle>
          </DialogHeader>
          {editing && (
            <RequestForm
              day={day}
              request={editing === "new" ? undefined : editing}
              onSaved={(text, saved) => {
                setEditing(null);
                setPicked(saved.need_date);
                notify(text);
                void refresh();
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
