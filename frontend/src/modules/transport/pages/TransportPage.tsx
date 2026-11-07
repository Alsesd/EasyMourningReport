/**
 * Transport: one page, four tabs (URL `?tab=`): orders, product requests, the dispatcher's day board, the fleet.
 * A tab is offered only to people whose permissions allow it; an unknown or forbidden `?tab=` opens the first one.
 */

import { useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { FleetPanel } from "@/modules/transport/components/FleetPanel";
import { OrdersPanel } from "@/modules/transport/components/OrdersPanel";
import { uk } from "@/modules/transport/i18n";
import { TP } from "@/modules/transport/permissions";
import { useAuth } from "@/platform/auth/AuthContext";
import { PageHeader } from "@/ui/PageHeader";
import { cn } from "@/ui/utils";

const t = uk.transport;

type TabId = "orders" | "products" | "board" | "fleet";

const TABS: { id: TabId; permissions: string[] }[] = [
  { id: "orders", permissions: [TP.create, TP.manage, TP.viewAll] },
  { id: "products", permissions: [TP.create, TP.manage, TP.viewAll] },
  { id: "board", permissions: [TP.manage, TP.viewAll] },
  { id: "fleet", permissions: [TP.manage] },
];

export default function TransportPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const allowed = TABS.filter((tab) => can(...tab.permissions));
  const asked = params.get("tab");
  const current = allowed.find((tab) => tab.id === asked) ?? allowed[0];
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  const open = (id: TabId) => setParams({ tab: id }, { replace: true });
  const onKey = (e: React.KeyboardEvent, index: number) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    const edge = e.key === "Home" ? 0 : e.key === "End" ? allowed.length - 1 : null;
    const next = edge ?? (step ? (index + step + allowed.length) % allowed.length : null);
    if (next === null) return;
    e.preventDefault();
    const tab = allowed[next];
    open(tab.id);
    refs.current[tab.id]?.focus();
  };

  return (
    <div className="space-y-6">
      <PageHeader title={t.title} />
      {allowed.length > 1 && (
        <div role="tablist" aria-label={t.tabsLabel} className="-mx-4 flex gap-1 overflow-x-auto border-b border-border px-4 sm:mx-0 sm:px-0">
          {allowed.map((tab, i) => {
            const selected = tab.id === current?.id;
            return (
              <button
                key={tab.id}
                ref={(el) => {
                  refs.current[tab.id] = el;
                }}
                type="button"
                role="tab"
                id={`transport-tab-${tab.id}`}
                aria-selected={selected}
                aria-controls={`transport-panel-${tab.id}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => open(tab.id)}
                onKeyDown={(e) => onKey(e, i)}
                className={cn(
                  "-mb-px min-h-[44px] shrink-0 border-b-2 px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                  selected ? "border-primary text-text-main" : "border-transparent text-text-muted hover:text-text-main",
                )}
              >
                {t.tabs[tab.id]}
              </button>
            );
          })}
        </div>
      )}
      {current && (
        <div role="tabpanel" id={`transport-panel-${current.id}`} aria-labelledby={`transport-tab-${current.id}`} tabIndex={-1} className="focus-visible:outline-none">
          {current.id === "orders" && <OrdersPanel />}
          {current.id === "fleet" && <FleetPanel />}
        </div>
      )}
    </div>
  );
}
