import React, { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { accessApi } from "@/platform/access/api";
import { ukPlatform as uk, formatDateTime } from "@/platform/i18n";
import { LedgerSection } from "@/ui/LedgerSection";
import { Button } from "@/ui/Button";
import { Input } from "@/ui/Input";
import { Filter, RefreshCw } from "lucide-react";
import { cn } from "@/ui/utils";

export default function AuditLogSection() {
  const [searchParams, setSearchParams] = useSearchParams();

  const urlLogin = searchParams.get("login") || "";
  const urlAction = searchParams.get("action") || "";

  const [loginInput, setLoginInput] = useState(urlLogin);
  const [actionInput, setActionInput] = useState(urlAction);

  useEffect(() => {
    setLoginInput(urlLogin);
    setActionInput(urlAction);
  }, [urlLogin, urlAction]);

  const { data: actionsList } = useQuery({
    queryKey: ["adminLogActions"],
    queryFn: () => accessApi.logActions(),
  });

  const {
    data: logs,
    isLoading,
    isFetching,
    error,
    refetch,
  } = useQuery({
    queryKey: ["adminLogs", urlLogin, urlAction],
    queryFn: () =>
      accessApi.logs({ limit: 200, login: urlLogin.trim() || undefined, action: urlAction.trim() || undefined }),
  });

  const handleFilterSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const next = new URLSearchParams();
    if (loginInput.trim()) next.set("login", loginInput.trim());
    if (actionInput.trim()) next.set("action", actionInput.trim());
    setSearchParams(next);
  };

  const logEntries = logs || [];

  return (
    <div className="space-y-6">
      <form onSubmit={handleFilterSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Input
          value={loginInput}
          onChange={(e) => setLoginInput(e.target.value)}
          placeholder="Фільтр за логіном…"
          autoCapitalize="none"
          aria-label="Логін"
          className="sm:max-w-[16rem]"
        />
        <select
          value={actionInput}
          onChange={(e) => setActionInput(e.target.value)}
          aria-label="Тип дії"
          className="min-h-[44px] w-full rounded-control border border-border bg-surface px-3 text-[15px] text-text-main hover:border-text-muted/50 sm:w-60"
        >
          <option value="">{uk.logs.allActions}</option>
          {(actionsList || []).map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <div className="flex gap-2">
          <Button type="submit" variant="outline" disabled={isLoading} className="flex-1 sm:flex-none">
            <Filter className="h-4 w-4" aria-hidden="true" />
            Фільтрувати
          </Button>
          <Button type="button" variant="ghost" size="icon" onClick={() => refetch()} disabled={isFetching} aria-label="Оновити" title="Оновити">
            <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} aria-hidden="true" />
          </Button>
        </div>
      </form>

      {error && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 border-l-2 border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <span>{error instanceof Error ? error.message : "Не вдалося завантажити журнал дій"}</span>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Повторити
          </Button>
        </div>
      )}

      <LedgerSection
        id="audit-entries"
        title="Записи журналу"
        description={isLoading ? undefined : `Показано записів: ${logEntries.length}`}
      >
        {isLoading ? (
          <p className="py-8 text-sm text-text-muted">Завантажую журнал…</p>
        ) : logEntries.length === 0 ? (
          <p className="py-8 text-sm text-text-muted">{uk.logs.noLogs}</p>
        ) : (
          <>
            <div className="hidden grid-cols-[10.5rem_minmax(0,8rem)_minmax(0,12rem)_minmax(0,1fr)] gap-x-4 border-b border-border px-1 py-2 text-xs font-medium text-text-muted md:grid">
              <span>Час і IP</span>
              <span>Користувач</span>
              <span>Дія</span>
              <span>Деталі</span>
            </div>
            <ul className="divide-y divide-border text-sm">
              {logEntries.map((entry) => (
                <li
                  key={entry.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 px-1 py-3 md:grid-cols-[10.5rem_minmax(0,8rem)_minmax(0,12rem)_minmax(0,1fr)]"
                >
                  <span className="figure col-start-2 row-start-1 text-right text-xs text-text-muted md:col-start-auto md:row-start-auto md:text-left">
                    <span className="block text-text-main">{formatDateTime(entry.ts)}</span>
                    {entry.ip && <span className="block">{entry.ip}</span>}
                  </span>
                  <span className="col-start-1 row-start-1 min-w-0 md:col-start-auto md:row-start-auto">
                    <span className="block font-medium text-text-main [overflow-wrap:anywhere]">{entry.login}</span>
                    <span className="block text-xs text-text-muted">{entry.role}</span>
                  </span>
                  <span className="col-span-2 font-medium text-text-main md:col-span-1">{entry.action}</span>
                  <span className="col-span-2 break-words text-text-muted [overflow-wrap:anywhere] md:col-span-1">{entry.detail}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        {logEntries.length === 200 && (
          <p className="border-t border-border px-1 py-3 text-xs text-text-muted">
            Показано останні 200 записів. Використовуйте фільтри, щоб звузити вибірку.
          </p>
        )}
      </LedgerSection>
    </div>
  );
}
