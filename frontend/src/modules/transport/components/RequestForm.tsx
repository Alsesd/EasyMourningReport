/** A desk's request for products: need date, optional car preference, rows of (product search, quantity). */

import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { transportApi } from "@/modules/transport/api";
import { transportError } from "@/modules/transport/errors";
import { createProductSearch } from "@/modules/transport/productSearch";
import { formatCurrency, shiftDay, todayIso, uk } from "@/modules/transport/i18n";
import type { Car, CatalogItem, ProductRequest, ProductRequestInput } from "@/modules/transport/types";
import { Button } from "@/ui/Button";
import { Combobox } from "@/ui/Combobox";
import { DayPicker } from "@/ui/DayPicker";
import { Input } from "@/ui/Input";
import { Notice, type NoticeMessage } from "@/ui/Notice";
import { QuantityStepper } from "@/ui/QuantityStepper";
import { CarPicker } from "./CarPicker";

const t = uk.transport;

interface Row {
  key: number;
  product: CatalogItem | null;
  quantity: number;
}

let nextKey = 1;
const blank = (): Row => ({ key: nextKey++, product: null, quantity: 1 });

/** Rows that are chosen, merged by product (the same product twice is one line). */
export function requestItems(rows: Row[]): { product_id: number; quantity: number }[] {
  const sum = new Map<number, number>();
  for (const r of rows) if (r.product && r.quantity > 0) sum.set(r.product.id, (sum.get(r.product.id) ?? 0) + r.quantity);
  return [...sum].map(([product_id, quantity]) => ({ product_id, quantity }));
}

export function RequestForm({ day, request, onSaved }: { day: string; request?: ProductRequest; onSaved: (message: string, saved: ProductRequest) => void }) {
  const catalog = useQuery({ queryKey: ["transport", "catalog"], queryFn: () => transportApi.catalog(), staleTime: 10 * 60_000 });
  const fleet = useQuery({ queryKey: ["transport", "cars"], queryFn: () => transportApi.cars(), staleTime: 60_000 });
  if (catalog.isLoading) return <p className="py-6 text-sm text-text-muted">{uk.common.loading}</p>;
  if (catalog.isError) return <Notice message={{ text: (catalog.error as Error).message, kind: "err" }} onDismiss={() => undefined} dismissLabel={uk.common.close} />;
  return <RequestFormBody day={day} request={request} catalog={catalog.data?.items ?? []} cars={fleet.data?.items ?? []} onSaved={onSaved} />;
}

function RequestFormBody({
  day,
  request,
  catalog,
  cars,
  onSaved,
}: {
  day: string;
  request?: ProductRequest;
  catalog: CatalogItem[];
  cars: Car[];
  onSaved: (message: string, saved: ProductRequest) => void;
}) {
  const today = todayIso();
  // A product that left the catalogue since the request was made stays selectable in that request.
  const products = useMemo(() => {
    const extra = (request?.items ?? []).filter((i) => !catalog.some((c) => c.id === i.product_id)).map((i) => ({ id: i.product_id, name: i.product_name, price_cents: i.unit_price_cents }));
    return [...catalog, ...extra];
  }, [catalog, request]);
  const index = useMemo(() => createProductSearch(products, (p) => p.name), [products]);
  const search = useCallback((q: string) => index.search(q), [index]);

  const [needDate, setNeedDate] = useState(request?.need_date ?? day);
  const [deceased, setDeceased] = useState(request?.deceased ?? "");
  const [notes, setNotes] = useState(request?.notes ?? "");
  const [carId, setCarId] = useState<number | null>(request?.car?.id ?? null);
  const [rows, setRows] = useState<Row[]>(() =>
    request ? request.items.map((i) => ({ key: nextKey++, product: products.find((p) => p.id === i.product_id) ?? null, quantity: i.quantity })) : [blank()],
  );
  const [message, setMessage] = useState<NoticeMessage | null>(null);

  const save = useMutation({
    mutationFn: (input: ProductRequestInput) => (request ? transportApi.updateRequest(request.id, input) : transportApi.createRequest(input)),
    onSuccess: (saved) => onSaved(request ? t.requestUpdated : t.requestSent, saved),
    onError: (err: Error) => setMessage({ text: transportError(err), kind: "err" }),
  });
  const setRow = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const total = rows.reduce((n, r) => n + (r.product?.price_cents ?? 0) * (r.product ? r.quantity : 0), 0);
  const anyPriced = rows.some((r) => r.product?.price_cents != null);

  return (
    <form
      className="space-y-5"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const empty = rows.findIndex((r) => !r.product && rows.length > 1);
        if (empty >= 0) return setMessage({ text: t.requestNeedProduct(empty + 1), kind: "err" });
        const items = requestItems(rows);
        if (items.length === 0) return setMessage({ text: t.requestNeedItem, kind: "err" });
        setMessage(null);
        save.mutate({ need_date: needDate, deceased: deceased.trim(), notes: notes.trim(), car_id: carId, items });
      }}
    >
      <Notice message={message} onDismiss={() => setMessage(null)} dismissLabel={uk.common.close} />
      <div className="space-y-1.5">
        <span className="text-sm font-medium text-text-main">{t.requestNeedDate}</span>
        <div role="group" aria-label={t.quickDays} className="flex flex-wrap gap-2">
          {[0, 1, 2].map((n) => {
            const d = shiftDay(today, n);
            return (
              <Button key={n} type="button" size="sm" variant={needDate === d ? "primary" : "outline"} aria-pressed={needDate === d} onClick={() => setNeedDate(d)}>
                {n === 0 ? t.dayTiming.today : n === 1 ? t.dayTiming.tomorrow : t.dayTiming.dayAfter}
              </Button>
            );
          })}
        </div>
        <DayPicker compact value={needDate} onChange={setNeedDate} labels={{ previous: t.previousDay, next: t.nextDay, day: t.requestNeedDate }} />
      </div>

      <fieldset className="space-y-3 border-t border-border pt-5">
        <legend className="float-left mb-3 text-base font-semibold text-text-main">{t.requestItems}</legend>
        {products.length === 0 && <p className="clear-both text-sm text-text-muted">{t.catalogEmpty}</p>}
        <ul className="clear-both space-y-4">
          {rows.map((r, i) => (
            <li key={r.key} className="space-y-2 border-b border-border pb-4">
              <Combobox
                label={`${t.requestProduct} ${rows.length > 1 ? i + 1 : ""}`.trim()}
                items={products}
                value={r.product}
                onChange={(product) => setRow(r.key, { product })}
                getKey={(p) => p.id}
                getLabel={(p) => p.name}
                renderMeta={(p) => <span className="figure">{p.price_cents == null ? t.noPrice : formatCurrency(p.price_cents)}</span>}
                search={search}
                placeholder={t.requestProductPlaceholder}
              />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <QuantityStepper label={r.product?.name ?? t.itemRow(i + 1)} value={r.quantity} min={1} max={999} onChange={(quantity) => setRow(r.key, { quantity })} />
                <div className="flex items-center gap-3">
                  {r.product && (
                    <p className="text-right text-sm text-text-muted">
                      {r.product.price_cents == null ? (
                        t.noPrice
                      ) : (
                        <>
                          <span className="figure">{formatCurrency(r.product.price_cents)}</span> × <span className="figure">{r.quantity}</span> ={" "}
                          <span className="figure font-semibold text-text-main">{formatCurrency(r.product.price_cents * r.quantity)}</span>
                        </>
                      )}
                    </p>
                  )}
                  {rows.length > 1 && (
                    <Button type="button" variant="ghost" size="icon" aria-label={t.removeItem(i + 1)} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>
                      <X className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
        <Button type="button" variant="outline" size="sm" onClick={() => setRows((rs) => [...rs, blank()])}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t.addItem}
        </Button>
        {anyPriced && (
          <p className="text-right text-sm text-text-muted">
            {t.requestTotal}: <span className="figure text-base font-semibold text-text-main">{formatCurrency(total)}</span>
          </p>
        )}
      </fieldset>

      <div className="space-y-4 border-t border-border pt-5">
        <div>
          <CarPicker id="request-car" label={t.requestCar} cars={cars.filter((c) => c.active || c.id === carId)} value={carId} onChange={setCarId} optional />
          <p className="mt-1 text-xs text-text-muted">{t.requestCarHint}</p>
        </div>
        <div>
          <label htmlFor="request-deceased" className="mb-1.5 block text-sm font-medium text-text-main">
            {t.requestDeceased}
          </label>
          <Input id="request-deceased" value={deceased} maxLength={200} onChange={(e) => setDeceased(e.target.value)} />
        </div>
        <div>
          <label htmlFor="request-notes" className="mb-1.5 block text-sm font-medium text-text-main">
            {t.requestNotes}
          </label>
          <Input id="request-notes" value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>

      <div className="sticky bottom-0 z-10 -mx-4 border-t border-border bg-surface px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
        <Button type="submit" className="min-h-[44px] w-full sm:w-auto" disabled={save.isPending}>
          {save.isPending ? t.saving : request ? t.saveChanges : t.save}
        </Button>
      </div>
    </form>
  );
}
