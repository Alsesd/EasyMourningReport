/** The «Автопарк» tab (dispatcher): the cars desks and the dispatcher choose from. List, add, take out of work. */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CarFront, Plus } from "lucide-react";
import { ApiError } from "@/platform/api/client";
import { transportApi } from "@/modules/transport/api";
import { PlateInput, type PlateValue } from "@/modules/transport/components/PlateInput";
import { uk } from "@/modules/transport/i18n";
import { normalizePlate, plateProblem } from "@/modules/transport/plate";
import type { Car } from "@/modules/transport/types";
import { Button } from "@/ui/Button";
import { useConfirm } from "@/ui/ConfirmDialog";
import { Input } from "@/ui/Input";
import { LedgerSection } from "@/ui/LedgerSection";
import { Notice, type NoticeMessage } from "@/ui/Notice";
import { cn } from "@/ui/utils";

const t = uk.transport;

export function FleetPanel() {
  const queryClient = useQueryClient();
  const { ask, dialog } = useConfirm(uk.common.cancel);
  const cars = useQuery({ queryKey: ["transport", "cars", "all"], queryFn: () => transportApi.cars(true) });
  const [plate, setPlate] = useState<PlateValue>({ plate: "", nonstandard: false });
  const [label, setLabel] = useState("");
  const [tried, setTried] = useState(false);
  const [message, setMessage] = useState<NoticeMessage | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["transport", "cars"] });

  const add = useMutation({
    mutationFn: () => transportApi.addCar({ plate: normalizePlate(plate.plate), nonstandard: plate.nonstandard, label: label.trim() }),
    onSuccess: () => {
      setPlate({ plate: "", nonstandard: false });
      setLabel("");
      setTried(false);
      setMessage({ text: t.fleetAdded, kind: "ok" });
      void refresh();
    },
    onError: (err: Error) => setMessage({ text: err instanceof ApiError && err.status === 409 ? t.fleetDuplicate : err.message, kind: "err" }),
  });
  const toggle = useMutation({
    mutationFn: (c: Car) => transportApi.updateCar(c.id, { active: !c.active }),
    onSuccess: () => {
      setMessage({ text: t.fleetUpdated, kind: "ok" });
      void refresh();
    },
    onError: (err: Error) => setMessage({ text: err.message, kind: "err" }),
  });

  const items = cars.data?.items ?? [];
  return (
    <div className="space-y-8">
      <Notice message={message} onDismiss={() => setMessage(null)} dismissLabel={uk.common.close} />

      <LedgerSection id="fleet-add" title={t.fleetAdd} description={t.fleetHint}>
        <form
          className="grid gap-4 px-1 py-4 sm:grid-cols-[auto_1fr_auto] sm:items-start"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            setTried(true);
            if (plateProblem(plate.plate, plate.nonstandard)) return;
            setMessage(null);
            add.mutate();
          }}
        >
          <PlateInput id="fleet-plate" value={plate} onChange={setPlate} showErrors={tried} />
          <div>
            <label htmlFor="fleet-label" className="mb-1.5 block text-sm font-medium text-text-main">
              {t.fleetLabelField}
            </label>
            <Input id="fleet-label" value={label} maxLength={100} onChange={(e) => setLabel(e.target.value)} />
          </div>
          <Button type="submit" className="sm:mt-[1.875rem]" disabled={add.isPending}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t.fleetAdd}
          </Button>
        </form>
      </LedgerSection>

      <LedgerSection id="fleet-list" title={t.fleetTitle} description={items.length > 0 ? `${items.filter((c) => c.active).length} / ${items.length}` : undefined}>
        {cars.isLoading ? (
          <p className="px-1 py-4 text-sm text-text-muted">{uk.common.loading}</p>
        ) : cars.isError ? (
          <p className="px-1 py-4 text-sm text-destructive">{(cars.error as Error).message}</p>
        ) : items.length === 0 ? (
          <p className="px-1 py-6 text-sm text-text-muted">{t.fleetEmpty}</p>
        ) : (
          <ul>
            {items.map((c) => (
              <li key={c.id} className={cn("flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-1 py-3", !c.active && "opacity-60")}>
                <CarFront className="h-5 w-5 shrink-0 text-text-muted" aria-hidden="true" />
                <span className="figure min-w-[8.5rem] text-lg font-semibold text-text-main">{c.display}</span>
                <span className="min-w-0 flex-1 break-words text-sm text-text-muted">
                  {c.label}
                  {c.nonstandard && <span className="ml-2 rounded-control border border-border px-1.5 py-0.5 text-xs">{t.plateNonstandard.split(" (")[0]}</span>}
                </span>
                <span className={cn("text-sm font-medium", c.active ? "text-primary" : "text-text-muted")}>{c.active ? t.fleetActive : t.fleetInactive}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={`${c.active ? t.fleetDeactivate : t.fleetActivate}: ${c.display}`}
                  disabled={toggle.isPending}
                  onClick={() =>
                    c.active
                      ? ask({ title: t.fleetDeactivate, description: t.fleetDeactivateConfirm(c.display), actionLabel: t.fleetDeactivate, onConfirm: () => toggle.mutate(c) })
                      : toggle.mutate(c)
                  }
                >
                  {c.active ? t.fleetDeactivate : t.fleetActivate}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </LedgerSection>
      {dialog}
    </div>
  );
}
