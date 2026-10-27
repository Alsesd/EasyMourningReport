import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/features/auth/AuthContext";
import { api } from "@/shared/api/client";
import type { StoreReportDTO } from "@/shared/api/types";
import { Button } from "@/shared/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/Card";
import { StatusPill } from "@/shared/components/ui/StatusPill";
import { formatCurrency, formatPeriodReadable } from "@/shared/i18n/uk";
import {
  ArrowRight,
  Building2,
  Clock3,
  FileText,
  ShieldCheck,
} from "lucide-react";
import { permissionCatalog } from "./permissions";

const reportCopy: Record<string, string> = {
  new: "Звіт за цей місяць ще не заповнено. Внесіть кількості товарів і надішліть його.",
  draft: "Чернетку збережено. Продовжте заповнення або надішліть звіт.",
  submitted: "Звіт надіслано та заблоковано для редагування.",
};

export default function WorkspaceDashboardPage() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const permissions = session?.permissions ?? [];
  const reportEnabled = permissions.includes("sales_report");
  const period = session?.period || new Date().toISOString().slice(0, 7);
  const displayName = session?.name || session?.login || "Користувач";
  const department = session?.department_name || "Відділ не вказано";
  const available = permissionCatalog.filter((permission) =>
    permissions.includes(permission.code)
  );
  const otherSections = available.filter((permission) => permission.code !== "sales_report");

  const { data: report, isLoading, isError } = useQuery<StoreReportDTO>({
    queryKey: ["storeReport", period],
    queryFn: async () =>
      api.get<StoreReportDTO>(`/api/v1/store/reports/${encodeURIComponent(period)}`),
    enabled: reportEnabled,
    staleTime: 60 * 1000,
  });

  const status = isError ? "none" : report?.status || "new";
  const filledPositions =
    report?.rows?.filter((row) => (row.inputs ?? []).some((input) => input.quantity > 0))
      .length ?? 0;
  const actionLabel =
    status === "submitted"
      ? "Переглянути звіт"
      : status === "draft"
        ? "Продовжити звіт"
        : "Заповнити звіт";
  const statusLabel = isError
    ? "Стан недоступний"
    : isLoading
      ? "Завантаження…"
      : undefined;
  const description = isError
    ? "Не вдалося завантажити стан звіту. Відкрийте звіт, щоб спробувати ще раз."
    : isLoading
      ? "Перевіряємо стан поточного звіту…"
      : reportCopy[status] || reportCopy.new;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
            Робочий простір
          </p>
          <h1 className="mt-1 text-xl font-bold tracking-tight sm:text-2xl">
            Вітаємо, {displayName}
          </h1>
          <p className="mt-1 text-sm text-text-muted">{department}</p>
        </div>
        <span className="inline-flex w-fit items-center rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium text-text-muted">
          <ShieldCheck className="mr-1.5 h-3.5 w-3.5 text-primary" />
          {available.length} {available.length === 1 ? "дозвіл" : "дозволи"}
        </span>
      </div>

      {reportEnabled ? (
        <section className="relative overflow-hidden rounded-card border border-border bg-surface p-5 shadow-xs sm:p-7">
          <div
            className="absolute -right-20 -top-20 h-56 w-56 rounded-full bg-primary/10 blur-3xl"
            aria-hidden="true"
          />
          <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                  Поточний звіт
                </p>
                <StatusPill status={status} customLabel={statusLabel} />
              </div>
              <h2 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">
                {formatPeriodReadable(period)}
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-text-muted">
                {description}
              </p>

              <div className="mt-5 grid max-w-md grid-cols-2 gap-3">
                <div className="rounded-control border border-border/70 bg-page/50 p-3">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-text-muted">
                    Сума звіту
                  </p>
                  <p className="mt-1 text-lg font-bold tabular-nums text-primary">
                    {isLoading || isError ? "—" : formatCurrency(report?.total_cents ?? 0)}
                  </p>
                </div>
                <div className="rounded-control border border-border/70 bg-page/50 p-3">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-text-muted">
                    Заповнено позицій
                  </p>
                  <p className="mt-1 text-lg font-bold tabular-nums">
                    {isLoading || isError ? "—" : filledPositions}
                  </p>
                </div>
              </div>
            </div>

            <div className="flex shrink-0 flex-col gap-2 lg:items-end">
              <Button className="min-h-[44px]" onClick={() => navigate("/report")}>
                <FileText className="mr-2 h-4 w-4" />
                {actionLabel}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
              <p className="text-[11px] text-text-muted">Дані за поточний місяць</p>
            </div>
          </div>
        </section>
      ) : (
        <section className="rounded-card border border-border bg-surface p-5 shadow-xs sm:p-6">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-primary/10 text-primary">
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Ваш робочий простір</h2>
              <p className="mt-1 text-sm leading-relaxed text-text-muted">
                Доступні розділи сформовано відповідно до прав, які надав
                адміністратор.
              </p>
            </div>
          </div>
        </section>
      )}

      {reportEnabled && otherSections.length > 0 && (
        <section>
          <div className="mb-3">
            <h2 className="text-lg font-semibold">Інші розділи</h2>
            <p className="text-xs text-text-muted">
              Розділи, до яких вам також надано доступ.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {otherSections.map((permission) => {
              const Icon = permission.icon;
              return (
                <Link
                  key={permission.code}
                  to={`/workspace/${permission.path}`}
                  className="group rounded-card border border-border bg-surface p-4 shadow-xs transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-primary/10 text-primary">
                      <Icon className="h-5 w-5" />
                    </div>
                    <ArrowRight className="h-4 w-4 text-text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                  </div>
                  <h3 className="mt-3 text-sm font-semibold">{permission.label}</h3>
                  <p className="mt-1 text-xs leading-relaxed text-text-muted">
                    {permission.description}
                  </p>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {!reportEnabled && (
        <section>
          <div className="mb-3">
            <h2 className="text-lg font-semibold">Ваші розділи</h2>
            <p className="text-xs text-text-muted">
              Натисніть на картку, щоб перейти до роботи з розділом.
            </p>
          </div>

          {available.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <p className="text-sm font-medium">Доступні розділи ще не налаштовані.</p>
                <p className="mt-1 text-xs text-text-muted">
                  Зверніться до адміністратора, щоб отримати права доступу.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {available.map((permission) => {
                const Icon = permission.icon;
                return (
                  <Link
                    key={permission.code}
                    to={`/workspace/${permission.path}`}
                    className="group rounded-card border border-border bg-surface p-4 shadow-xs transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-primary/10 text-primary">
                        <Icon className="h-5 w-5" />
                      </div>
                      <ArrowRight className="h-4 w-4 text-text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                    </div>
                    <h3 className="mt-3 text-sm font-semibold">{permission.label}</h3>
                    <p className="mt-1 text-xs leading-relaxed text-text-muted">
                      {permission.description}
                    </p>
                  </Link>
                );
              })}
            </div>
          )}
        </section>
      )}

      <Card className="border-dashed bg-page/40">
        <CardHeader className="border-b border-border/60 p-4">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Clock3 className="h-4 w-4 text-text-muted" />
            Історія та аналітика
          </CardTitle>
        </CardHeader>
        <CardContent className="p-5 text-sm text-text-muted">
          Тут з’являться останні дії, статистика та історія по вашому відділу.
          Дані підключаться разом із робочими модулями.
        </CardContent>
      </Card>
    </div>
  );
}
