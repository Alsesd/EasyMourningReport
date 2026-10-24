import React, { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import type { AuditLogDTO } from "@/api/types";
import { uk, formatDateTime } from "@/i18n/uk";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { ShieldCheck, Filter, AlertCircle, RefreshCw } from "lucide-react";

export default function AdminLogsPage() {
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
    queryFn: () => api.get<string[]>("/api/v1/admin/log-actions"),
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
      api.get<AuditLogDTO[]>("/api/v1/admin/logs", {
        params: {
          limit: 200,
          login: urlLogin.trim() || undefined,
          action: urlAction.trim() || undefined,
        },
      }),
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
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-text-main">{uk.logs.title}</h1>
          <p className="text-sm text-text-muted mt-1">
            Аудит дій користувачів та змін у системі
          </p>
        </div>

        <Button
          variant="outline"
          size="sm"
          className="min-h-[44px] self-start sm:self-auto"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
          Оновити
        </Button>
      </div>

      {/* Filter Form Card */}
      <Card>
        <CardContent className="p-4 sm:p-5">
          <form onSubmit={handleFilterSubmit} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <div className="flex-1">
              <Input
                value={loginInput}
                onChange={(e) => setLoginInput(e.target.value)}
                placeholder="Фільтр за логіном…"
                autoCapitalize="none"
                aria-label="Логін"
                className="h-11"
              />
            </div>

            <div className="w-full sm:w-60">
              <select
                value={actionInput}
                onChange={(e) => setActionInput(e.target.value)}
                aria-label="Тип дії"
                className="h-11 w-full rounded-control border border-border bg-page px-3 py-2 text-sm text-text-main focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary min-h-[44px]"
              >
                <option value="">{uk.logs.allActions}</option>
                {(actionsList || []).map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </div>

            <Button type="submit" className="min-h-[44px] shrink-0" disabled={isLoading}>
              <Filter className="h-4 w-4 mr-2" />
              Фільтрувати
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Error State */}
      {error && (
        <div
          role="status"
          aria-live="polite"
          className="p-4 rounded-card bg-destructive/10 border border-destructive/20 text-destructive flex items-center justify-between"
        >
          <div className="flex items-center space-x-2">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <span className="text-sm">
              {error instanceof Error ? error.message : "Не вдалося завантажити журнал дій"}
            </span>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Повторити
          </Button>
        </div>
      )}

      {/* Logs Table Card */}
      <Card>
        <CardHeader className="p-4 sm:p-5 border-b border-border">
          <CardTitle className="text-base sm:text-lg flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              <span>Записи журналу</span>
            </div>
            <span className="text-xs font-normal text-text-muted tabular-nums">
              Знайдено: {logEntries.length}
            </span>
          </CardTitle>
        </CardHeader>
        <div className="overflow-x-auto">
          {isLoading ? (
            <div className="p-8 text-center text-text-muted text-sm flex flex-col items-center justify-center space-y-2">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              <span>Завантажую журнал…</span>
            </div>
          ) : (
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-page/50 text-text-muted text-xs uppercase tracking-wider font-semibold">
                  <th className="py-3 px-4 whitespace-nowrap min-w-[160px]">Час</th>
                  <th className="py-3 px-3 whitespace-nowrap min-w-[120px]">Користувач</th>
                  <th className="py-3 px-3 whitespace-nowrap min-w-[90px]">Роль</th>
                  <th className="py-3 px-3 whitespace-nowrap min-w-[130px]">Дія</th>
                  <th className="py-3 px-4 min-w-[240px]">Деталі</th>
                  <th className="py-3 px-4 whitespace-nowrap min-w-[120px]">IP-адреса</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {logEntries.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-text-muted text-sm">
                      {uk.logs.noLogs}
                    </td>
                  </tr>
                ) : (
                  logEntries.map((entry) => (
                    <tr key={entry.id} className="hover:bg-page/40 transition-colors">
                      <td className="py-3 px-4 whitespace-nowrap tabular-nums font-mono text-xs text-text-muted">
                        {formatDateTime(entry.ts)}
                      </td>
                      <td className="py-3 px-3 font-medium text-text-main">
                        {entry.login}
                      </td>
                      <td className="py-3 px-3 text-xs">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ${
                            entry.role === "admin"
                              ? "bg-primary/10 text-primary"
                              : "bg-surface border border-border text-text-muted"
                          }`}
                        >
                          {entry.role}
                        </span>
                      </td>
                      <td className="py-3 px-3 font-mono text-xs text-text-main">
                        {entry.action}
                      </td>
                      <td className="py-3 px-4 text-xs text-text-muted max-w-md break-words">
                        {entry.detail}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap font-mono text-xs text-text-muted">
                        {entry.ip}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
        {logEntries.length === 200 && (
          <div className="p-4 border-t border-border bg-page/30 text-xs text-text-muted text-center">
            Показано останні 200 записів. Використовуйте фільтри, щоб звузити вибірку.
          </div>
        )}
      </Card>
    </div>
  );
}
