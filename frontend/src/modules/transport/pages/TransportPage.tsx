/**
 * Transport orders. Desks (organisation employees with "create") fill in the day's table and follow the
 * dispatcher's replies; dispatchers (platform staff) see every desk's orders in one chronological list, set
 * the reply status and read the history. Delivery and carriers of one deceased share a row.
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Plus, Printer } from "lucide-react";
import { Link } from "react-router-dom";
import { transportApi, type OrderQuery } from "@/modules/transport/api";
import { OrderCard } from "@/modules/transport/components/OrderCard";
import { DateStrip, STRIP_LENGTH } from "@/modules/transport/components/DateStrip";
import { OrderForm } from "@/modules/transport/components/OrderForm";
import { BearersForm } from "@/modules/transport/components/BearersForm";
import { StatusForm } from "@/modules/transport/components/StatusDialog";
import { uk, formatDateTime, formatDayReadable, shiftDay, todayIso } from "@/modules/transport/i18n";
import { TP } from "@/modules/transport/permissions";
import { useAuth } from "@/platform/auth/AuthContext";
import type { TransportOrderDTO } from "@/platform/api/types";
import { Button, buttonClass } from "@/ui/Button";
import { useConfirm } from "@/ui/ConfirmDialog";
import { DayPicker } from "@/ui/DayPicker";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/ui/Dialog";
import { LedgerSection } from "@/ui/LedgerSection";
import { Notice, type NoticeMessage } from "@/ui/Notice";
import { PageHeader } from "@/ui/PageHeader";
import { OrderStatus } from "@/modules/transport/components/StatusPill";
import { dayTiming, isOpen } from "@/modules/transport/timing";
import type { TransportDayDTO } from "@/platform/api/types";

const t = uk.transport;
const POLL_MS = 15000;
const dayLabels = { previous: t.previousDay, next: t.nextDay, day: t.dayLabel, today: t.today };
/** How far back unclosed orders and how far ahead orders in work are looked for. */
const LOOK_BACK = 60;
const LOOK_AHEAD = 120;
/** The strip starts two days before the chosen day, so yesterday stays in sight. */
const LEAD = 2;

/** "Сьогодні", "Завтра", "через 7 днів", "3 дні тому" for a day heading. */
function dayTimingLabel(day: string, today: string): string {
  const { kind, days } = dayTiming(day, today);
  const d = t.dayTiming;
  if (kind === "later") return d.later(days);
  if (kind === "past" || kind === "overdue") return d.past(days);
  return d[kind];
}

function byDay(days: TransportDayDTO[] | undefined): Map<string, TransportDayDTO> {
  return new Map((days ?? []).map((d) => [d.date, d]));
}

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

/** Today's date that follows the clock: a page left open overnight moves to the new day unless a day was picked. */
function useToday(): string {
  const [today, setToday] = useState(todayIso());
  useEffect(() => {
    const id = window.setInterval(() => setToday(todayIso()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return today;
}

export default function TransportPage() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const desk = can(TP.create);
  const staff = can(TP.manage, TP.viewAll);
  const manage = can(TP.manage);

  const [mode, setMode] = useState<"day" | "history">("day");
  const today = useToday();
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  const [pickedStart, setStart] = useState<string | null>(null);
  const [pickedFrom, setFrom] = useState<string | null>(null);
  const [pickedTo, setTo] = useState<string | null>(null);
  const day = pickedDay ?? today;
  const start = pickedStart ?? shiftDay(day, -LEAD);
  /** Choose a day; the strip follows when the day falls outside it. */
  const setDay = (next: string) => {
    setPickedDay(next);
    if (next < start || next > shiftDay(start, STRIP_LENGTH - 1)) setStart(shiftDay(next, -LEAD));
  };
  const from = pickedFrom ?? shiftDay(today, -7);
  const to = pickedTo ?? today;
  const { ask, dialog: confirmDialog } = useConfirm(uk.common.cancel);
  // "" all, "open" / "closed" a group, otherwise one status (sent to the server).
  const [status, setStatus] = useState("");
  const [message, setMessage] = useState<NoticeMessage | null>(null);
  const [editing, setEditing] = useState<TransportOrderDTO | "new" | null>(null);
  const [replying, setReplying] = useState<{ order: TransportOrderDTO; status: string } | null>(null);
  const [history, setHistory] = useState<TransportOrderDTO | null>(null);
  const [assigning, setAssigning] = useState<TransportOrderDTO | null>(null);

  const single = status !== "" && status !== "open" && status !== "closed";
  const query: OrderQuery = mode === "day" ? { date: day } : { from, to, ...(single ? { status } : {}) };
  const orders = useQuery({
    queryKey: ["transport", "orders", query],
    queryFn: () => transportApi.orders(query),
    refetchInterval: POLL_MS, // the desks' notification: the dispatcher's reply shows up by itself
  });
  const stripRange = { from: start, to: shiftDay(start, STRIP_LENGTH - 1) };
  const strip = useQuery({
    queryKey: ["transport", "days", stripRange],
    queryFn: () => transportApi.days(stripRange),
    refetchInterval: POLL_MS,
    enabled: mode === "day",
  });
  // Unclosed orders of past days and orders in work on the days ahead, whatever day is shown.
  const overviewRange = { from: shiftDay(today, -LOOK_BACK), to: shiftDay(today, LOOK_AHEAD) };
  const overview = useQuery({
    queryKey: ["transport", "days", overviewRange],
    queryFn: () => transportApi.days(overviewRange),
    refetchInterval: POLL_MS,
  });
  const stripCounts = useMemo(() => byDay(strip.data), [strip.data]);
  const overdueDays = (overview.data ?? []).filter((d) => d.date < today && d.open > 0);
  const overdueCount = overdueDays.reduce((n, d) => n + d.open, 0);
  const aheadDays = (overview.data ?? []).filter((d) => d.date > today && d.open > 0);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["transport"] });
  const notify = (text: string) => setMessage({ text, kind: "ok" });

  const cancel = (o: TransportOrderDTO) =>
    ask({
      title: t.cancelOrder,
      description: `${t.cancelConfirm} ${o.deceased}, ${formatDayReadable(o.service_date)}, ${o.sort_time}.`,
      actionLabel: t.cancelOrder,
      onConfirm: async () => {
        try {
          await transportApi.cancel(o.id);
          notify(t.cancelled);
        } catch (err) {
          setMessage({ text: (err as Error).message, kind: "err" });
        }
        void refresh();
      },
    });

  const list = (orders.data ?? []).filter((o) => (status === "open" ? isOpen(o.status) : status === "closed" ? !isOpen(o.status) : true));
  const dayOpen = list.filter((o) => isOpen(o.status)).length;
  const attention = mode === "day" ? (stripCounts.get(day)?.attention ?? 0) : 0;
  const emptyText = mode === "history" ? t.emptyHistory : desk && !staff ? t.emptyDesk : t.empty;
  // History is grouped by day; the day view is a single group.
  const days = [...new Set(list.map((o) => o.service_date))];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t.title}
        meta={t.pollHint}
        actions={
          <>
            {staff && mode === "day" && (
              <Link to={`/admin/transport/schedule?date=${day}`} className={buttonClass("outline")}>
                <Printer className="h-4 w-4" aria-hidden="true" />
                {t.schedule}
              </Link>
            )}
            {desk && (
              <Button type="button" onClick={() => setEditing("new")}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                {t.newOrder}
              </Button>
            )}
          </>
        }
      />
      <Notice message={message} onDismiss={() => setMessage(null)} dismissLabel={uk.common.close} />

      {overdueCount > 0 && (
        <div role="status" className="flex flex-wrap items-center gap-3 rounded-control border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="flex-1 font-medium">{t.overdueNotice(overdueCount)}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setMode("day");
              setDay(overdueDays[0].date);
            }}
          >
            {t.overdueShow}: {formatDayReadable(overdueDays[0].date)}
          </Button>
        </div>
      )}

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
          <>
            <DayPicker compact value={day} onChange={setDay} labels={{ ...dayLabels, day: t.jumpToDay }} className="w-full sm:w-auto sm:max-w-xs sm:flex-1" />
            {day !== today && (
              <Button type="button" variant="outline" className="min-h-[44px]" onClick={() => setDay(today)}>
                {t.today}
              </Button>
            )}
          </>
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
          </>
        )}
        <select
          aria-label={t.statusFilter}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="h-11 w-full rounded-control border border-border bg-surface px-3 text-[0.9375rem] text-text-main sm:w-auto"
        >
          <option value="">{t.allStatuses}</option>
          <option value="open">{t.groupOpen}</option>
          <option value="closed">{t.groupClosed}</option>
          <optgroup label={t.statusFilter}>
            {Object.entries(t.statuses).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </optgroup>
        </select>
      </div>

      {mode === "day" && <DateStrip start={start} onStart={setStart} value={day} onChange={setDay} today={today} counts={stripCounts} />}

      <LedgerSection
        id="orders"
        title={mode === "day" ? `${formatDayReadable(day)} · ${dayTimingLabel(day, today)}` : `${formatDayReadable(from)} — ${formatDayReadable(to)}`}
        description={
          orders.isError
            ? (orders.error as Error).message
            : mode === "day" && list.length > 0
              ? [t.dayOpen(dayOpen), t.dayClosed(list.length - dayOpen)].join(" · ") +
                (attention > 0 ? ` · ${manage ? t.attentionDispatcher(attention) : t.attentionDesk(attention)}` : "")
              : undefined
        }
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
                    showDay={mode === "history"}
                    today={today}
                    onEdit={desk ? setEditing : undefined}
                    onCancel={desk ? cancel : undefined}
                    onAction={manage ? (order, s) => setReplying({ order, status: s }) : undefined}
                    onHistory={staff ? setHistory : undefined}
                    onBearers={manage ? setAssigning : undefined}
                  />
                ))}
            </div>
          ))
        )}
      </LedgerSection>

      <LedgerSection id="ahead" title={t.upcomingTitle} description={t.upcomingHint}>
        {aheadDays.length === 0 ? (
          <p className="px-1 py-4 text-sm text-text-muted">{t.upcomingEmpty}</p>
        ) : (
          <ul className="flex flex-wrap gap-2 px-1 py-3">
            {aheadDays.slice(0, 12).map((d) => (
              <li key={d.date}>
                <button
                  type="button"
                  onClick={() => {
                    setMode("day");
                    setDay(d.date);
                  }}
                  className={`flex min-h-[44px] items-center gap-2 rounded-control border px-3 text-left text-sm hover:bg-surface-raised ${d.date === day && mode === "day" ? "border-primary" : "border-border"}`}
                >
                  <span className="font-medium text-text-main">{formatDayReadable(d.date)}</span>
                  <span className="text-text-muted">{dayTimingLabel(d.date, today)}</span>
                  <span className={`figure rounded-full px-1.5 text-xs font-semibold ${d.attention > 0 ? "bg-attention text-page" : "bg-primary text-primary-fg"}`}>{d.open}</span>
                </button>
              </li>
            ))}
            {aheadDays.length > 12 && <li className="self-center text-sm text-text-muted">{t.upcomingMore(aheadDays.length - 12)}</li>}
          </ul>
        )}
      </LedgerSection>

      {confirmDialog}

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editing === "new" ? t.newOrder : t.editOrder}</DialogTitle>
          </DialogHeader>
          {editing && (
            <OrderForm
              day={day}
              order={editing === "new" ? undefined : editing}
              onSaved={(text, saved) => {
                setEditing(null);
                // An order saved for another day would vanish from the list: show its day instead.
                if (saved.service_date !== day) {
                  setMode("day");
                  setDay(saved.service_date);
                  notify(editing === "new" ? t.savedFor(formatDayReadable(saved.service_date)) : text);
                } else notify(text);
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

      <Dialog open={assigning !== null} onOpenChange={(open) => !open && setAssigning(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.bearersTitle}</DialogTitle>
          </DialogHeader>
          {assigning && (
            <BearersForm
              order={assigning}
              onDone={() => {
                setAssigning(null);
                notify(t.bearersSaved);
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
