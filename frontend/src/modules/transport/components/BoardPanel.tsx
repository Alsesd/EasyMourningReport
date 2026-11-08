/**
 * The «Рейси» tab: the dispatcher's day. One lane per car with its transport orders and goods runs in time order,
 * what each car carries, a lane for work without a car, and the product requests that are not fully loaded yet.
 */

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CarFront, PackageOpen, Pencil, Plus, Route, Truck } from "lucide-react";
import { transportApi } from "@/modules/transport/api";
import { buildLanes, type Lane, type LaneEntry } from "@/modules/transport/board";
import { AssignmentForm } from "@/modules/transport/components/AssignmentForm";
import { CargoManifest } from "@/modules/transport/components/CargoManifest";
import { useDispatchDialogs } from "@/modules/transport/components/DispatchDialogs";
import { RequestCard } from "@/modules/transport/components/RequestCard";
import { OrderStatus } from "@/modules/transport/components/StatusPill";
import { transportError } from "@/modules/transport/errors";
import { POLL_MS, useToday } from "@/modules/transport/hooks";
import { formatDayReadable, uk } from "@/modules/transport/i18n";
import { TP } from "@/modules/transport/permissions";
import { isOpen } from "@/modules/transport/timing";
import type { Run } from "@/modules/transport/types";
import { useAuth } from "@/platform/auth/AuthContext";
import type { TransportOrderDTO } from "@/platform/api/types";
import { Button } from "@/ui/Button";
import { useConfirm } from "@/ui/ConfirmDialog";
import { DayPicker } from "@/ui/DayPicker";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/ui/Dialog";
import { LedgerSection } from "@/ui/LedgerSection";
import { Notice, type NoticeMessage } from "@/ui/Notice";
import { cn } from "@/ui/utils";

const t = uk.transport;
const dayLabels = { previous: t.previousDay, next: t.nextDay, day: t.dayLabel, today: t.today };
const NEXT_RUN: Record<string, string[]> = { planned: ["in_progress", "cancelled"], in_progress: ["done", "cancelled"], done: [], cancelled: [] };

function RunStatus({ status }: { status: string }) {
  const tone = status === "in_progress" ? "text-primary" : status === "done" ? "text-text-main" : status === "cancelled" ? "text-text-muted" : "text-attention";
  return <span className={cn("whitespace-nowrap text-sm font-medium", tone)}>{t.runStatuses[status] ?? status}</span>;
}

function LaneRow({
  entry,
  manage,
  onAssign,
  onEditRun,
  onRunStatus,
}: {
  entry: LaneEntry;
  manage: boolean;
  onAssign: (o: TransportOrderDTO) => void;
  onEditRun: (r: Run) => void;
  onRunStatus: (r: Run, status: string) => void;
}) {
  if (entry.kind === "order") {
    const o = entry.order;
    const parts = entry.parts.map((p) => (p === "delivery" ? `${t.delivery} ${o.delivery?.time}` : `${t.carriers} ${o.carriers?.time}`)).join(" · ");
    return (
      <li className="space-y-2 border-b border-border px-1 py-3 last:border-b-0" aria-label={`${t.sectionDelivery}: ${o.deceased}, ${entry.time}`}>
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
          <div className="flex min-w-0 items-baseline gap-3">
            <span className="figure text-xl font-semibold text-text-main">{entry.time}</span>
            <div className="min-w-0">
              <p className="break-words font-serif text-base font-semibold text-text-main">{o.deceased}</p>
              <p className="text-sm text-text-muted">
                {o.organisation.name} · {parts}
              </p>
            </div>
          </div>
          <OrderStatus status={o.status} />
        </div>
        <CargoManifest manifest={o.cargo} />
        {manage && isOpen(o.status) && (
          <Button type="button" variant="outline" size="sm" onClick={() => onAssign(o)}>
            <CarFront className="h-4 w-4" aria-hidden="true" />
            {t.assignAction}
          </Button>
        )}
      </li>
    );
  }
  const r = entry.run;
  return (
    <li className="space-y-2 border-b border-border px-1 py-3 last:border-b-0" aria-label={t.runTitle(r.car.display, r.time)}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="flex min-w-0 items-baseline gap-3">
          <span className="figure text-xl font-semibold text-text-main">{r.time}</span>
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-base font-semibold text-text-main">
              <Truck className="h-4 w-4 text-primary" aria-hidden="true" />
              {t.runGoods}
            </p>
            <p className="flex items-start gap-1.5 break-words text-sm text-text-muted">
              <Route className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              {[r.departure, ...[...r.stops].sort((a, b) => a.position - b.position).map((s) => s.place)].join(" → ")}
            </p>
          </div>
        </div>
        <RunStatus status={r.status} />
      </div>
      <CargoManifest manifest={r.manifest} />
      {r.notes && <p className="text-sm text-text-muted">{r.notes}</p>}
      {manage && (
        <div className="flex flex-wrap gap-2">
          {r.status === "planned" && (
            <Button type="button" variant="outline" size="sm" onClick={() => onEditRun(r)}>
              <Pencil className="h-4 w-4" aria-hidden="true" />
              {uk.common.edit}
            </Button>
          )}
          {NEXT_RUN[r.status]?.map((s) => (
            <Button key={s} type="button" size="sm" variant={s === "cancelled" ? "ghost" : "secondary"} onClick={() => onRunStatus(r, s)}>
              {t.runStatusActions[s]}
            </Button>
          ))}
        </div>
      )}
    </li>
  );
}

export function BoardPanel() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const manage = can(TP.manage);
  const today = useToday();
  const [picked, setPicked] = useState<string | null>(null);
  const day = picked ?? today;
  const [message, setMessage] = useState<NoticeMessage | null>(null);
  const [assign, setAssign] = useState<TransportOrderDTO | null>(null);
  const { ask, dialog: confirmDialog } = useConfirm(uk.common.cancel);
  const notify = (text: string) => setMessage({ text, kind: "ok" });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["transport"] });

  const board = useQuery({ queryKey: ["transport", "board", day], queryFn: () => transportApi.board(day), refetchInterval: POLL_MS });
  const data = board.data;
  const lanes = useMemo<Lane[]>(() => (data ? buildLanes(data.orders, data.runs, data.cars) : []), [data]);
  const busy = new Set(lanes.map((l) => l.carId));
  const idle = (data?.cars ?? []).filter((c) => c.active && !busy.has(c.id));
  const dispatch = useDispatchDialogs({ day, cars: data?.cars ?? [], openRequests: data?.open_requests ?? [], notify });

  const runStatus = (r: Run, status: string) => {
    const go = async () => {
      try {
        await transportApi.setRunStatus(r.id, status);
        notify(t.runStatusDone);
      } catch (err) {
        setMessage({ text: transportError(err), kind: "err" });
      }
      void refresh();
    };
    if (status === "cancelled") ask({ title: t.runStatusActions.cancelled, description: t.runTitle(r.car.display, r.time), actionLabel: t.runStatusActions.cancelled, onConfirm: go });
    else void go();
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-prose text-sm text-text-muted">{t.boardHint}</p>
        {manage && (
          <Button type="button" onClick={() => dispatch.newRun()}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t.newRun}
          </Button>
        )}
      </div>
      <Notice message={message} onDismiss={() => setMessage(null)} dismissLabel={uk.common.close} />
      <DayPicker value={day} onChange={setPicked} labels={dayLabels} className="w-full sm:max-w-md" />

      <LedgerSection id="board" title={`${t.boardTitle} · ${formatDayReadable(day)}`} description={board.isError ? (board.error as Error).message : undefined}>
        {board.isLoading ? (
          <div className="space-y-3 px-1 py-4" aria-busy="true">
            <p className="text-sm text-text-muted">{uk.common.loading}</p>
            <div className="h-24 animate-pulse rounded-control bg-surface-raised motion-reduce:animate-none" aria-hidden="true" />
          </div>
        ) : lanes.length === 0 ? (
          <p className="px-1 py-6 text-sm text-text-muted">{t.boardEmpty}</p>
        ) : (
          <div className="grid gap-6 lg:grid-cols-2">
            {lanes.map((lane) => (
              <section key={lane.carId ?? `x-${lane.display}`} aria-label={lane.display || t.laneUnassigned} className="min-w-0 rounded-card border border-border bg-surface p-3">
                <h3 className={cn("flex items-center gap-2 border-b border-ink pb-2 text-base font-semibold", lane.display ? "text-text-main" : "text-attention")}>
                  <CarFront className="h-5 w-5" aria-hidden="true" />
                  <span className="figure">{lane.display || t.laneUnassigned}</span>
                  <span className="ml-auto text-sm font-normal text-text-muted">{lane.entries.length}</span>
                </h3>
                <ul>
                  {lane.entries.map((e) => (
                    <LaneRow key={e.key} entry={e} manage={manage} onAssign={setAssign} onEditRun={dispatch.editRun} onRunStatus={runStatus} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
        {idle.length > 0 && (
          <p className="px-1 pt-4 text-sm text-text-muted">
            {t.idleCars}: <span className="figure text-text-main">{idle.map((c) => c.display).join(", ")}</span>
          </p>
        )}
      </LedgerSection>

      <LedgerSection id="unplanned" title={t.unplannedTitle} description={t.unplannedHint}>
        {board.isLoading ? null : (data?.open_requests ?? []).length === 0 ? (
          <p className="flex items-center gap-2 px-1 py-6 text-sm text-text-muted">
            <PackageOpen className="h-4 w-4" aria-hidden="true" />
            {t.unplannedEmpty}
          </p>
        ) : (
          [...(data?.open_requests ?? [])]
            .sort((a, b) => a.need_date.localeCompare(b.need_date))
            .map((r) => <RequestCard key={r.id} request={r} showOrganisation onAddToRun={manage ? dispatch.addToRun : undefined} onReject={manage ? dispatch.reject : undefined} />)
        )}
      </LedgerSection>

      {confirmDialog}
      {dispatch.dialogs}

      <Dialog open={assign !== null} onOpenChange={(o) => !o && setAssign(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t.assignTitle}</DialogTitle>
          </DialogHeader>
          {assign && (
            <AssignmentForm
              order={assign}
              cars={data?.cars ?? []}
              onDone={() => {
                setAssign(null);
                notify(t.assignSaved);
                void refresh();
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
