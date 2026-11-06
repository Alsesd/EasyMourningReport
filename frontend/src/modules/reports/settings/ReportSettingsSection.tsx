/** Per-organisation report options: the «По розрахунку» calculation-quantity mode. */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { reportsApi } from "@/modules/reports/api";
import { uk } from "@/modules/reports/i18n";
import type { AdminSectionProps } from "@/platform/modules";
import { LedgerSection } from "@/ui/LedgerSection";
import { Switch } from "@/ui/Switch";

export default function ReportSettingsSection({ notify }: AdminSectionProps) {
  const queryClient = useQueryClient();
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["reportSettings"],
    queryFn: () => reportsApi.reportSettings(),
  });
  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) => reportsApi.setCalculationEnabled(id, enabled),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reportSettings"] });
      notify(uk.settings.reportSettings.updated);
    },
    onError: (err: Error) => notify(err.message, "err"),
  });
  const visible = rows.filter((r) => !r.archived || r.calculation_enabled);

  return (
    <LedgerSection id="calculation" title={uk.settings.reportSettings.title} description={uk.settings.reportSettings.description} className="max-w-3xl">
      <div className="divide-y divide-border">
        {isLoading ? (
          <p className="py-6 text-sm text-text-muted">{uk.common.loading}</p>
        ) : visible.length === 0 ? (
          <p className="py-6 text-sm text-text-muted">{uk.settings.reportSettings.empty}</p>
        ) : (
          visible.map((row) => (
            <div key={row.organisation_id} className="flex min-h-[60px] items-center justify-between gap-4 px-1 py-1">
              <span className="min-w-0">
                <span className="block font-medium text-text-main">{row.organisation_name}</span>
                <span className="block text-xs text-text-muted">{uk.settings.reportSettings.reportsCount(row.reports_count ?? 0)}</span>
              </span>
              <Switch
                label={`${uk.settings.reportSettings.title}: ${row.organisation_name}`}
                onText={uk.settings.reportSettings.enabled}
                offText={uk.settings.reportSettings.disabled}
                checked={row.calculation_enabled}
                disabled={toggle.isPending}
                onChange={(enabled) => toggle.mutate({ id: row.organisation_id, enabled })}
              />
            </div>
          ))
        )}
      </div>
    </LedgerSection>
  );
}
