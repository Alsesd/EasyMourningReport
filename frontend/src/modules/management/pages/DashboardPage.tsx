/** Management dashboard: business figures from every module the caller may see, for one month. */

import { SkeletonRows } from "@/ui/Skeleton";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { dashboardApi } from "@/modules/management/api";
import { BarSeries, RankedRows, Tiles } from "@/modules/management/components/blocks";
import { todayIso, uk } from "@/modules/management/i18n";
import { LedgerSection } from "@/ui/LedgerSection";
import { PageHeader } from "@/ui/PageHeader";
import { PeriodPicker } from "@/ui/PeriodPicker";

const t = uk.management;
const REFRESH_MS = 60000;

export default function DashboardPage() {
  const [period, setPeriod] = useState(() => todayIso().slice(0, 7));
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["dashboard", period],
    queryFn: () => dashboardApi.get(period),
    refetchInterval: REFRESH_MS,
  });

  return (
    <div className="space-y-8">
      <PageHeader title={t.title} meta={t.subtitle} actions={<PeriodPicker value={period} onChange={setPeriod} labels={{ previous: t.previousMonth, next: t.nextMonth, month: t.month }} />} />
      {isLoading ? (
        <SkeletonRows rows={3} />
      ) : isError ? (
        <p className="text-sm text-destructive">{(error as Error).message}</p>
      ) : !data || data.blocks.length === 0 ? (
        <p className="text-sm text-text-muted">{t.empty}</p>
      ) : (
        data.blocks.map((b) => (
          <LedgerSection key={b.key} id={`dash-${b.key}`} title={b.title} description={b.description}>
            {(b.tiles ?? []).length > 0 && <Tiles tiles={b.tiles ?? []} />}
            {(b.series ?? []).map((s) => (
              <BarSeries key={s.title} series={s} />
            ))}
            <div className="grid gap-x-8 md:grid-cols-2">
              {(b.lists ?? []).map((l) => (
                <RankedRows key={l.title} list={l} />
              ))}
            </div>
          </LedgerSection>
        ))
      )}
    </div>
  );
}
