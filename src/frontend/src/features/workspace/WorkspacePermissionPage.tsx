import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "@/features/auth/AuthContext";
import { Button } from "@/shared/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/Card";
import { ArrowLeft, ArrowRight, Building2, Clock3, LockKeyhole, ShieldCheck } from "lucide-react";
import { permissionByPath, permissionCatalog } from "./permissions";

export default function WorkspacePermissionPage() {
  const { permissionPath } = useParams<{ permissionPath: string }>();
  const { session } = useAuth();
  const navigate = useNavigate();
  const permission = permissionPath ? permissionByPath.get(permissionPath) : undefined;

  if (!permission) {
    return <Navigate to="/workspace" replace />;
  }

  const permissions = session?.permissions ?? [];
  const allowed = permissions.includes(permission.code);
  const Icon = permission.icon;

  if (!allowed) {
    return (
      <Card className="mx-auto max-w-xl">
        <CardContent className="p-8 text-center">
          <LockKeyhole className="mx-auto h-10 w-10 text-text-muted" />
          <h1 className="mt-4 text-xl font-bold">Немає доступу</h1>
          <p className="mt-2 text-sm text-text-muted">
            Ваш обліковий запис не має дозволу «{permission.label}». Зверніться до
            адміністратора.
          </p>
          <Button className="mt-5" onClick={() => navigate(-1)}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Назад
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Link
        to="/workspace"
        className="inline-flex items-center text-xs font-medium text-text-muted transition-colors hover:text-primary"
      >
        <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
        До робочого простору
      </Link>

      <section className="rounded-card border border-border bg-surface p-5 sm:p-7 shadow-xs">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-control bg-primary/10 text-primary">
              <Icon className="h-6 w-6" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                {permission.label}
              </p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight">
                {permission.description}
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-text-muted">
                {permission.hint}
              </p>
            </div>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-control border border-border/70 bg-page/50 p-3">
            <p className="flex items-center gap-1.5 text-[11px] text-text-muted">
              <ShieldCheck className="h-3.5 w-3.5" /> Користувач
            </p>
            <p className="mt-1 text-sm font-semibold">
              {session?.name || session?.login || "—"}
            </p>
          </div>
          <div className="rounded-control border border-border/70 bg-page/50 p-3">
            <p className="flex items-center gap-1.5 text-[11px] text-text-muted">
              <Building2 className="h-3.5 w-3.5" /> Відділ
            </p>
            <p className="mt-1 text-sm font-semibold">
              {session?.department_name || "Не вказано"}
            </p>
          </div>
          <div className="rounded-control border border-border/70 bg-page/50 p-3">
            <p className="flex items-center gap-1.5 text-[11px] text-text-muted">
              <LockKeyhole className="h-3.5 w-3.5" /> Дозвіл
            </p>
            <p className="mt-1 text-sm font-semibold">{permission.label}</p>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="border-dashed bg-page/40">
          <CardHeader className="border-b border-border/60 p-4">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Clock3 className="h-4 w-4 text-text-muted" />
              Історія
            </CardTitle>
          </CardHeader>
          <CardContent className="p-5 text-sm text-text-muted">
            Історія дій за цим розділом з’явиться після запуску відповідного модуля.
          </CardContent>
        </Card>
        <Card className="border-dashed bg-page/40">
          <CardHeader className="border-b border-border/60 p-4">
            <CardTitle className="text-sm">Аналітика</CardTitle>
          </CardHeader>
          <CardContent className="p-5">
            <div className="flex h-24 items-end gap-2" aria-hidden="true">
              {[36, 58, 44, 74, 52, 82, 64].map((height, index) => (
                <div
                  key={index}
                  className="flex-1 rounded-t bg-primary/15"
                  style={{ height: `${height}%` }}
                />
              ))}
            </div>
            <p className="mt-3 text-xs text-text-muted">
              Графіки та показники з’являться після накопичення даних.
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap gap-2">
        {permissionCatalog
          .filter((item) => item.code !== permission.code && permissions.includes(item.code))
          .map((item) => (
            <Link
              key={item.code}
              to={`/workspace/${item.path}`}
              className="inline-flex items-center rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium text-text-muted transition-colors hover:border-primary/40 hover:text-primary"
            >
              {item.label}
              <ArrowRight className="ml-1.5 h-3 w-3" />
            </Link>
          ))}
      </div>
    </div>
  );
}
