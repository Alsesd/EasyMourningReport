/** Per-organisation report options: the «По розрахунку» calculation-quantity mode. */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { reportsApi } from "@/modules/reports/api";
import { uk } from "@/modules/reports/i18n";
import type { AdminSectionProps } from "@/platform/modules";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/Card";
import { Calculator } from "lucide-react";
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
    <Card className="max-w-3xl animate-fade-in">
      <CardHeader className="p-4 sm:p-5 border-b border-border">
        <CardTitle className="text-base flex items-center space-x-2">
          <Calculator className="h-5 w-5 text-primary" />
          <span>{uk.settings.reportSettings.title}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <p className="px-4 sm:px-5 pt-4 text-sm text-text-muted">{uk.settings.reportSettings.description}</p>
        <div className="divide-y divide-border mt-3">
          {isLoading ? (
            <p className="p-5 text-sm text-text-muted">{uk.common.loading}</p>
          ) : visible.length === 0 ? (
            <p className="p-5 text-sm text-text-muted">{uk.settings.reportSettings.empty}</p>
          ) : (
            visible.map((row) => (
              <div
                key={row.organisation_id}
                className="flex items-center justify-between gap-4 px-4 sm:px-5 min-h-[60px]"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-text-main truncate">{row.organisation_name}</span>
                  <span className="block text-xs text-text-muted">
                    {uk.settings.reportSettings.reportsCount(row.reports_count ?? 0)}
                  </span>
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
      </CardContent>
    </Card>
  );
}
