import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { api } from "@/shared/api/client";
import type { MutationDTO, StoreDTO } from "@/shared/api/types";
import { AnimatedCollapse } from "@/shared/components/ui/AnimatedCollapse";
import { Button } from "@/shared/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/Card";
import { Input } from "@/shared/components/ui/Input";
import { cn } from "@/shared/lib/utils";
import {
  Archive,
  BarChart3,
  Building2,
  Clock3,
  Plus,
  RotateCcw,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { permissionLabel } from "@/features/workspace/permissions";
import { ConfirmDialog } from "./ConfirmDialog";
import type { ConfirmModalState, Notify } from "./types";

interface Props {
  notify: Notify;
}

export default function DepartmentsSettings({ notify }: Props) {
  const queryClient = useQueryClient();
  const [, setSearchParams] = useSearchParams();
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [nameInput, setNameInput] = useState<Record<number, string>>({});
  const [confirmModal, setConfirmModal] = useState<ConfirmModalState>({
    open: false,
    title: "",
    description: "",
    actionLabel: "",
    variant: "destructive",
    onConfirm: () => {},
  });

  const { data: storesData, isLoading } = useQuery({
    queryKey: ["adminStores"],
    queryFn: () => api.get<StoreDTO[]>("/api/v1/admin/stores"),
  });
  const stores = useMemo(() => storesData || [], [storesData]);
  const activeStores = stores.filter((store) => !store.archived);
  const archivedStores = stores.filter((store) => store.archived);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["adminStores"] });
    queryClient.invalidateQueries({ queryKey: ["adminUsers"] });
  };

  const createMutation = useMutation({
    mutationFn: (name: string) => api.post<StoreDTO>("/api/v1/admin/stores", { name }),
    onSuccess: (created) => {
      invalidate();
      setNewName("");
      setCreateOpen(false);
      notify(`Відділ «${created.name}» створено.`);
    },
    onError: (error: Error) => notify(error.message || "Не вдалося створити відділ.", "err"),
  });

  const updateMutation = useMutation({
    mutationFn: (payload: { id: number; name: string }) =>
      api.put<StoreDTO>(`/api/v1/admin/stores/${payload.id}`, { name: payload.name }),
    onSuccess: (updated) => {
      invalidate();
      notify(`Відділ «${updated.name}» оновлено.`);
    },
    onError: (error: Error) => notify(error.message || "Не вдалося оновити відділ.", "err"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete<MutationDTO>(`/api/v1/admin/stores/${id}`),
    onSuccess: (response) => {
      invalidate();
      notify(response?.message || "Відділ видалено або архівовано.");
    },
    onError: (error: Error) => notify(error.message || "Не вдалося видалити відділ.", "err"),
  });

  const restoreMutation = useMutation({
    mutationFn: (id: number) => api.post<StoreDTO>(`/api/v1/admin/stores/${id}/restore`),
    onSuccess: (restored) => {
      invalidate();
      notify(`Відділ «${restored.name}» відновлено.`);
    },
    onError: (error: Error) => notify(error.message || "Не вдалося відновити відділ.", "err"),
  });

  const openUsersTab = () => {
    const next = new URLSearchParams();
    next.set("tab", "users");
    setSearchParams(next);
  };

  const confirmDelete = (store: StoreDTO) => {
    const hasReports = store.reports_count > 0;
    const hasUsers = (store.users ?? []).length > 0;
    setConfirmModal({
      open: true,
      title: hasReports ? "Перемістити відділ в архів?" : "Видалити відділ?",
      description: hasReports
        ? `«${store.name}» має звіти (${store.reports_count}). Відділ буде архівовано, а звіти збережено.`
        : hasUsers
          ? `«${store.name}» має ${(store.users ?? []).length} користувач(ів). Відділ і його облікові записи буде видалено остаточно.`
          : `«${store.name}» не має звітів і користувачів. Видалити відділ остаточно?`,
      actionLabel: hasReports ? "В архів" : "Видалити",
      variant: "destructive",
      onConfirm: () => deleteMutation.mutate(store.id),
    });
  };

  return (
    <>
      <div className="space-y-6 animate-fade-in">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-text-muted">
            Відділи об’єднують користувачів і звіти. Статистика, аналітика та
            історія оновлюватимуться разом із робочими модулями.
          </p>
          <Button
            className="min-h-[44px] shrink-0"
            onClick={() => setCreateOpen((open) => !open)}
          >
            {createOpen ? <X className="mr-1.5 h-4 w-4" /> : <Plus className="mr-1.5 h-4 w-4" />}
            {createOpen ? "Скасувати" : "Створити відділ"}
          </Button>
        </div>

        <AnimatedCollapse open={createOpen}>
          <Card className="border-primary/50 bg-surface/90 shadow-sm backdrop-blur-xs">
            <CardHeader className="border-b border-border p-4 sm:p-5">
              <CardTitle className="flex items-center gap-2 text-base">
                <Building2 className="h-4 w-4 text-primary" />
                Новий відділ
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 sm:p-5">
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!newName.trim()) return;
                  createMutation.mutate(newName.trim());
                }}
                className="flex flex-col gap-3 sm:flex-row sm:items-end"
              >
                <div className="flex-1 space-y-1.5">
                  <label className="text-xs font-medium text-text-muted">Назва відділу</label>
                  <Input
                    value={newName}
                    onChange={(event) => setNewName(event.target.value)}
                    placeholder="Наприклад, Відділ логістики"
                    maxLength={100}
                    required
                    className="h-11"
                  />
                </div>
                <Button type="submit" disabled={createMutation.isPending} className="min-h-[44px]">
                  {createMutation.isPending ? "Створюю…" : "Додати відділ"}
                </Button>
              </form>
              <p className="mt-3 text-xs text-text-muted">
                Користувачів додавайте на вкладці{" "}
                <button
                  type="button"
                  onClick={openUsersTab}
                  className="font-medium text-primary underline-offset-2 hover:underline"
                >
                  «Користувачі»
                </button>
                .
              </p>
            </CardContent>
          </Card>
        </AnimatedCollapse>

        <Card>
          <CardHeader className="border-b border-border p-4 sm:p-5">
            <CardTitle className="flex items-center justify-between text-base">
              <span>Відділи ({activeStores.length})</span>
              {isLoading && <span className="text-xs font-normal text-text-muted">Завантаження…</span>}
            </CardTitle>
          </CardHeader>
          <div className="divide-y divide-border">
            {activeStores.length === 0 && !isLoading && (
              <div className="p-8 text-center text-sm text-text-muted">
                Відділів ще немає. Створіть перший відділ.
              </div>
            )}
            {activeStores.map((store) => {
              const users = store.users ?? [];
              const currentName = nameInput[store.id] ?? store.name;
              const changed = currentName.trim() !== store.name;
              return (
                <div key={store.id} className="space-y-4 p-4 transition-colors hover:bg-page/20 sm:p-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 flex-1">
                      <label className="mb-1 block text-[11px] text-text-muted">Назва відділу</label>
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <Input
                          value={currentName}
                          onChange={(event) =>
                            setNameInput((prev) => ({ ...prev, [store.id]: event.target.value }))
                          }
                          maxLength={100}
                          className="h-11 max-w-md font-medium"
                        />
                        {changed && (
                          <Button
                            size="sm"
                            className="min-h-[44px] animate-scale-in"
                            disabled={updateMutation.isPending || !currentName.trim()}
                            onClick={() =>
                              updateMutation.mutate({
                                id: store.id,
                                name: currentName.trim(),
                              })
                            }
                          >
                            Зберегти
                          </Button>
                        )}
                      </div>
                      <p className="mt-2 flex items-center gap-1.5 text-xs text-text-muted">
                        <Users className="h-3.5 w-3.5" />
                        {users.length} користувач(ів)
                      </p>
                    </div>

                    <div className="flex items-center gap-3 self-end lg:self-start">
                      <div className="text-right">
                        <p className="text-[10px] uppercase tracking-wide text-text-muted">Звітів</p>
                        <p className="text-lg font-bold tabular-nums">{store.reports_count}</p>
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="text-destructive hover:bg-destructive/10"
                        title="Видалити або перемістити в архів"
                        aria-label={`Видалити ${store.name}`}
                        onClick={() => confirmDelete(store)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.4fr_1fr_1fr]">
                    <div className="rounded-control border border-border/70 bg-page/40 p-3">
                      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-text-muted">
                        <Users className="h-3.5 w-3.5" /> Користувачі відділу
                      </p>
                      {users.length === 0 ? (
                        <p className="text-xs text-text-muted">Ще немає користувачів.</p>
                      ) : (
                        <div className="space-y-2">
                          {users.map((user) => (
                            <div key={user.id} className="flex flex-wrap items-center gap-2">
                              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                                {user.name.slice(0, 2).toUpperCase()}
                              </span>
                              <span className="text-xs font-medium">{user.name}</span>
                              <span className="font-mono text-[10px] text-text-muted">{user.login}</span>
                              <span className="flex flex-wrap gap-1">
                                {(user.permissions ?? []).map((code) => (
                                  <span
                                    key={code}
                                    className="rounded-full border border-border bg-surface px-1.5 py-0.5 text-[9px] text-text-muted"
                                  >
                                    {permissionLabel(code)}
                                  </span>
                                ))}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="rounded-control border border-dashed border-border/70 bg-page/20 p-3">
                      <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-text-muted">
                        <BarChart3 className="h-3.5 w-3.5" /> Аналітика
                      </p>
                      <div className="mt-3 flex h-12 items-end gap-1.5" aria-hidden="true">
                        {[40, 65, 50, 80, 58].map((height, index) => (
                          <div
                            key={index}
                            className={cn("flex-1 rounded-t bg-primary/15", index === 3 && "bg-primary/30")}
                            style={{ height: `${height}%` }}
                          />
                        ))}
                      </div>
                      <p className="mt-2 text-[10px] text-text-muted">Дані з’являться пізніше</p>
                    </div>

                    <div className="rounded-control border border-dashed border-border/70 bg-page/20 p-3">
                      <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-text-muted">
                        <Clock3 className="h-3.5 w-3.5" /> Історія
                      </p>
                      <p className="mt-3 text-xs text-text-muted">
                        Останні події відділу з’являться після запуску модулів.
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        {archivedStores.length > 0 && (
          <Card className="border-dashed border-border/80 bg-page/30">
            <CardHeader className="border-b border-border p-4 sm:p-5">
              <CardTitle className="flex items-center gap-2 text-sm text-text-muted">
                <Archive className="h-4 w-4" />
                Архів відділів ({archivedStores.length})
              </CardTitle>
            </CardHeader>
            <div className="divide-y divide-border/60">
              {archivedStores.map((store) => (
                <div key={store.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-medium text-text-muted line-through">{store.name}</p>
                    <p className="text-xs text-text-muted">
                      {(store.users ?? []).length} користувач(ів) · звітів: {store.reports_count}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="min-h-[44px]"
                    onClick={() => restoreMutation.mutate(store.id)}
                    disabled={restoreMutation.isPending}
                  >
                    <RotateCcw className="mr-1.5 h-4 w-4" />
                    Відновити
                  </Button>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>

      <ConfirmDialog
        state={confirmModal}
        onOpenChange={(open) => setConfirmModal((prev) => ({ ...prev, open }))}
      />
    </>
  );
}
