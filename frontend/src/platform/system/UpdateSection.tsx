/** Program updates: current and latest release, manual check and install, automatic updates status. */

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle } from "lucide-react";
import { systemApi } from "@/platform/system/api";
import { formatDateTime, ukPlatform as uk } from "@/platform/i18n";
import type { AdminSectionProps } from "@/platform/modules";
import type { UpdateStatusDTO } from "@/platform/api/types";
import { Button } from "@/ui/Button";
import { StateDot } from "@/ui/StateDot";

const t = uk.system.update;

export default function UpdateSection({ notify }: AdminSectionProps) {
  const queryClient = useQueryClient();
  const [restarting, setRestarting] = useState(false);
  const { data: status, isError } = useQuery({
    queryKey: ["adminUpdate"],
    queryFn: () => systemApi.update(),
    refetchInterval: restarting ? 1500 : 30000,
  });
  const set = (next: UpdateStatusDTO) => queryClient.setQueryData(["adminUpdate"], next);
  const onError = (err: Error) => notify(err.message, "err");

  const check = useMutation({ mutationFn: () => systemApi.checkUpdate(), onSuccess: set, onError });
  const apply = useMutation({
    mutationFn: () => systemApi.applyUpdate(),
    onSuccess: (next) => {
      set(next);
      setRestarting(true);
    },
    onError,
  });

  // After "restarting" the old process is gone; once the new one answers with another version, reload the page.
  const before = status?.current;
  useEffect(() => {
    if (restarting && status && !isError && status.current !== before) window.location.reload();
  }, [restarting, status, isError, before]);

  if (!status) return <p className="text-sm text-text-muted">{uk.common.loading}</p>;

  return (
    <div className="max-w-2xl space-y-6">
      <div className="ledger flex flex-wrap items-center justify-between gap-3 border-b border-border px-1 py-3">
        <p className="text-sm text-text-muted">{t.subtitle}</p>
        <span className="flex shrink-0 items-center gap-2 font-medium text-text-main">
          <StateDot tone={status.state === "error" ? "error" : status.state === "idle" ? "idle" : "busy"} />
          {t.states[status.state] ?? status.state}
        </span>
      </div>

      {!status.enabled && <p className="border-l-2 border-border px-3 py-2 text-sm text-text-muted">{t.disabled}</p>}
      {status.enabled && !status.writable && (
        <div role="alert" className="flex items-start gap-2 border-l-2 border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{t.notWritable}</span>
        </div>
      )}
      {status.error && (
        <div role="alert" className="flex items-start gap-2 border-l-2 border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="break-words">{status.error}</span>
        </div>
      )}

      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
        <dt className="text-text-muted">{t.current}</dt>
        <dd className="figure text-text-main">{status.current || t.devBuild}</dd>
        <dt className="text-text-muted">{t.latest}</dt>
        <dd className="figure text-text-main">{status.latest || "—"}</dd>
        <dt className="text-text-muted">{t.lastChecked}</dt>
        <dd className="figure text-text-main">{status.last_checked ? formatDateTime(status.last_checked) : t.never}</dd>
        <dt className="text-text-muted">{t.auto}</dt>
        <dd className="text-text-main">
          {status.auto ? uk.system.on : uk.system.off} <span className="text-text-muted">· {t.autoHint}</span>
        </dd>
      </dl>

      {status.enabled && status.latest && (
        <p className="flex items-center gap-2 text-sm text-text-main">
          {status.available ? (
            <>
              <AlertCircle className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              {t.available}: <span className="figure">{status.latest}</span>
            </>
          ) : (
            <>
              <CheckCircle className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              {t.upToDate}
            </>
          )}
        </p>
      )}
      {restarting && <p role="status" className="text-sm text-text-muted">{t.restarting}</p>}

      {status.enabled && (
        <div className="flex flex-wrap gap-3">
          <Button type="button" variant="secondary" className="min-h-[44px]" onClick={() => check.mutate()} disabled={check.isPending || apply.isPending}>
            {check.isPending ? t.checking : t.check}
          </Button>
          <Button
            type="button"
            className="min-h-[44px]"
            onClick={() => apply.mutate()}
            disabled={!status.available || !status.writable || apply.isPending || restarting}
          >
            {apply.isPending ? t.applying : t.apply}
          </Button>
        </div>
      )}
    </div>
  );
}
