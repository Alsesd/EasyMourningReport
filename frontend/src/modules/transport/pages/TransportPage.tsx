/**
 * Transport orders. Desks (organisation employees with "create") fill in the day's table and follow the
 * dispatcher's replies; dispatchers (platform staff) see every desk's orders in one chronological list, set
 * the reply status and read the history. Delivery and carriers of one deceased share a row.
 */

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { transportApi, type OrderQuery } from "@/modules/transport/api";
import { OrderCard } from "@/modules/transport/components/OrderCard";
import { OrderForm } from "@/modules/transport/components/OrderForm";
import { StatusForm } from "@/modules/transport/components/StatusDialog";
import { uk, formatDateTime, formatDayReadable, shiftDay, todayIso } from "@/modules/transport/i18n";
import { TP } from "@/modules/transport/permissions";
import { useAuth } from "@/platform/auth/AuthContext";
import type { TransportOrderDTO } from "@/platform/api/types";
import { Button } from "@/ui/Button";
import { DayPicker } from "@/ui/DayPicker";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/ui/Dialog";
import { LedgerSection } from "@/ui/LedgerSection";
import { Notice, type NoticeMessage } from "@/ui/Notice";
import { PageHeader } from "@/ui/PageHeader";
import { OrderStatus } from "@/modules/transport/components/StatusPill";

const t = uk.transport;
const POLL_MS = 15000;
const dayLabels = { previous: t.previousDay, next: t.nextDay, day: t.dayLabel, today: t.today };

function HistoryList({ id }: { id: number }) {
  const { data } = useQuery({ queryKey: ["transport", "order", id], queryFn: () => transportApi.order(id) });
  if (!data) return <p className="text-sm text-text-muted">{uk.common.loading}</p>;
  if (data.events.length === 0) return <p className="text-sm text-text-muted">{t.noHistory}</p>;
  return (
    <ol className="divide-y divide-border border-y border-border">
      {data.events.map((e, i) => (
        <li key={i} className="space-y-0.5 py-2.5 text-sm">
          <p className="flex flex-wrap items-center gap-x-3 text-text-main">
            <span className="figure text-text-muted">{formatDateTime(e.ts)}</span>
            <span className="font-medium">{e.kind === "status" ? <OrderStatus status={e.status} /> : t.events[e.kind]}</span>
            <span className="text-text-muted">{e.user_name}</span>
          </p>
          {e.note && <p className="text-text-muted">{e.note}</p>}
        </li>
      ))}
    </ol>
  );
}

export default function TransportPage() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const desk = can(TP.create);
  const staff = can(TP.manage, TP.viewAll);
  const manage = can(TP.manage);

  const [mode, setMode] = useState<"day" | "history">("day");
  const [day, setDay] = useState(todayIso());
  const [from, setFrom] = useState(shiftDay(todayIso(), -7));
  const [to, setTo] = useState(todayIso());
  const [status, setStatus] = useState("");
  const [message, setMessage] = useState<NoticeMessage | null>(null);
  const [editing, setEditing] = useState<TransportOrderDTO | "new" | null>(null);
  const [replying, setReplying] = useState<{ order: TransportOrderDTO; status: string } | null>(null);
  const [history, setHistory] = useState<TransportOrderDTO | null>(null);

  const query: OrderQuery = mode === "day" ? { date: day } : { from, to, ...(status ? { status } : {}) };
  const orders = useQuery({
    queryKey: ["transport", "orders", query],
    queryFn: () => transportApi.orders(query),
    refetchInterval: POLL_MS, // the desks' notification: the dispatcher's reply shows up by itself
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["transport"] });
  const notify = (text: string) => setMessage({ text, kind: "ok" });

  const cancel = async (o: TransportOrderDTO) => {
    if (!window.confirm(t.cancelConfirm)) return;
    try {
      await transportApi.cancel(o.id);
      notify(t.cancelled);
    } catch (err) {
      setMessage({ text: (err as Error).message, kind: "err" });
    }
    void refresh();
  };

  const list = orders.data ?? [];
  const emptyText = mode === "history" ? t.emptyHistory : desk && !staff ? t.emptyDesk : t.empty;
  // History is grouped by day; the day view is a single group.
  const days = [...new Set(list.map((o) => o.service_date))];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t.title}
        meta={t.pollHint}
        actions={
          desk && (
            <Button type="button" onClick={() => setEditing("new")}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              {t.newOrder}
            </Button>
          )
        }
      />
      <Notice message={message} onDismiss={() => setMessage(null)} dismissLabel={uk.common.close} />

      <div className="flex flex-wrap items-center gap-3">
        <div role="group" aria-label={t.title} className="inline-flex overflow-hidden rounded-control border border-border">
          {(["day", "history"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
              className={`min-h-[44px] px-4 text-sm font-medium ${mode === m ? "bg-primary text-primary-fg" : "bg-surface text-text-main hover:bg-surface-raised"}`}
            >
              {m === "day" ? t.modeDay : t.modeHistory}
            </button>
          ))}
        </div>
        {mode === "day" ? (
          <DayPicker value={day} onChange={setDay} labels={dayLabels} />
        ) : (
          <>
            <label className="flex items-center gap-2 text-sm text-text-muted">
              {t.from}
              <DayPicker compact value={from} onChange={setFrom} labels={{ ...dayLabels, day: t.from }} />
            </label>
            <label className="flex items-center gap-2 text-sm text-text-muted">
              {t.to}
              <DayPicker compact value={to} onChange={setTo} labels={{ ...dayLabels, day: t.to }} />
            </label>
            <select
              aria-label={t.statusFilter}
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="h-11 rounded-control border border-border bg-surface px-3 text-[15px] text-text-main"
            >
              <option value="">{t.allStatuses}</option>
              {Object.entries(t.statuses).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </>
        )}
      </div>

      <LedgerSection
        id="orders"
        title={mode === "day" ? formatDayReadable(day) : `${formatDayReadable(from)} — ${formatDayReadable(to)}`}
        description={orders.isError ? (orders.error as Error).message : undefined}
      >
        {orders.isLoading ? (
          <p className="px-1 py-4 text-sm text-text-muted">{uk.common.loading}</p>
        ) : list.length === 0 ? (
          <p className="px-1 py-4 text-sm text-text-muted">{emptyText}</p>
        ) : (
          days.map((d) => (
            <div key={d}>
              {mode === "history" && <h3 className="px-1 pt-4 text-sm font-semibold text-text-muted">{formatDayReadable(d)}</h3>}
              {list
                .filter((o) => o.service_date === d)
                .map((o) => (
                  <OrderCard
                    key={o.id}
                    order={o}
                    showOrganisation={staff}
                    showDay={false}
                    onEdit={desk ? setEditing : undefined}
                    onCancel={desk ? cancel : undefined}
                    onAction={manage ? (order, s) => setReplying({ order, status: s }) : undefined}
                    onHistory={staff ? setHistory : undefined}
                  />
                ))}
            </div>
          ))
        )}
      </LedgerSection>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editing === "new" ? t.newOrder : t.editOrder}</DialogTitle>
          </DialogHeader>
          {editing && (
            <OrderForm
              day={day}
              order={editing === "new" ? undefined : editing}
              onSaved={(text) => {
                setEditing(null);
                notify(text);
                void refresh();
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={replying !== null} onOpenChange={(open) => !open && setReplying(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{replying ? t.statusDialogTitle(t.statuses[replying.status] ?? replying.status) : ""}</DialogTitle>
          </DialogHeader>
          {replying && (
            <StatusForm
              order={replying.order}
              status={replying.status}
              onDone={() => {
                setReplying(null);
                void refresh();
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={history !== null} onOpenChange={(open) => !open && setHistory(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t.historyTitle}</DialogTitle>
          </DialogHeader>
          {history && (
            <>
              <p className="text-sm text-text-muted">
                {history.organisation.name} · {history.deceased}
              </p>
              <HistoryList id={history.id} />
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
