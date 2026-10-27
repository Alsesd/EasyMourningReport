import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/shared/api/client";
import type { MessageDTO, MutationDTO, StoreDTO } from "@/shared/api/types";
import { AnimatedCollapse } from "@/shared/components/ui/AnimatedCollapse";
import { Button } from "@/shared/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/Card";
import { Input } from "@/shared/components/ui/Input";
import { Archive, KeyRound, Plus, RotateCcw, Trash2 } from "lucide-react";
import { ConfirmDialog } from "./ConfirmDialog";
import type { ConfirmModalState, Notify } from "./types";

interface Props {
  notify: Notify;
}

export default function StoresSettings({ notify }: Props) {
  const queryClient = useQueryClient();

  const [createStoreOpen, setCreateStoreOpen] = useState(false);
  const [newStoreName, setNewStoreName] = useState("");
  const [newStoreLogin, setNewStoreLogin] = useState("");
  const [newStorePassword, setNewStorePassword] = useState("");

  const [storeNameInput, setStoreNameInput] = useState<Record<number, string>>({});
  const [storeLoginInput, setStoreLoginInput] = useState<Record<number, string>>({});
  const [storePasswordInput, setStorePasswordInput] = useState<Record<number, string>>({});

  const { data: storesData, isLoading: storesLoading } = useQuery({
    queryKey: ["adminStores"],
    queryFn: () => api.get<StoreDTO[]>("/api/v1/admin/stores"),
  });

  const stores = useMemo(() => storesData || [], [storesData]);

  const createStoreMutation = useMutation({
    mutationFn: (data: { name: string; login: string; password: string }) =>
      api.post<StoreDTO>("/api/v1/admin/stores", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["adminStores"] });
      setNewStoreName("");
      setNewStoreLogin("");
      setNewStorePassword("");
      setCreateStoreOpen(false);
      notify("Магазин успішно створено.");
    },
    onError: (err: Error) => notify(err.message || "Не вдалося створити магазин.", "err"),
  });

  const updateStoreMutation = useMutation({
    mutationFn: (data: { id: number; name: string; login: string }) =>
      api.put<StoreDTO>(`/api/v1/admin/stores/${data.id}`, { name: data.name, login: data.login }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["adminStores"] });
      notify("Дані магазину оновлено.");
    },
    onError: (err: Error) => notify(err.message || "Не вдалося оновити магазин.", "err"),
  });

  const resetStorePasswordMutation = useMutation({
    mutationFn: (data: { id: number; password: string }) =>
      api.put<MessageDTO>(`/api/v1/admin/stores/${data.id}/password`, { password: data.password }),
    onSuccess: (_, vars) => {
      setStorePasswordInput((prev) => ({ ...prev, [vars.id]: "" }));
      notify("Пароль магазину успішно змінено.");
    },
    onError: (err: Error) => notify(err.message || "Не вдалося змінити пароль.", "err"),
  });

  const deleteStoreMutation = useMutation({
    mutationFn: (id: number) => api.delete<MutationDTO>(`/api/v1/admin/stores/${id}`),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["adminStores"] });
      notify(res?.message || "Магазин видалено або архівовано.");
    },
    onError: (err: Error) => notify(err.message || "Не вдалося видалити магазин.", "err"),
  });

  const restoreStoreMutation = useMutation({
    mutationFn: (id: number) => api.post<MutationDTO>(`/api/v1/admin/stores/${id}/restore`),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["adminStores"] });
      notify(res?.message || "Магазин відновлено.");
    },
    onError: (err: Error) => notify(err.message || "Не вдалося відновити магазин.", "err"),
  });

  const [confirmModal, setConfirmModal] = useState<ConfirmModalState>({
    open: false,
    title: "",
    description: "",
    actionLabel: "",
    variant: "primary",
    onConfirm: () => {},
  });

  useEffect(() => {
    if (stores.length > 0) {
      const nMap: Record<number, string> = {};
      const lMap: Record<number, string> = {};
      stores.forEach((s) => {
        nMap[s.id] = s.name;
        lMap[s.id] = s.login;
      });
      setStoreNameInput((prev) => ({ ...nMap, ...prev }));
      setStoreLoginInput((prev) => ({ ...lMap, ...prev }));
    }
  }, [stores]);

  const activeStores = stores.filter((s) => !s.archived);
  const archivedStores = stores.filter((s) => s.archived);

  return (
    <>
      <div className="space-y-6 animate-fade-in">
        <div className="flex justify-between items-center">
          <p className="text-sm text-text-muted">
            Зміна назви чи логіну не впливає на вже подані звіти. Пароль змінюється окремо.
          </p>
          <Button
            variant="primary"
            className="min-h-[44px]"
            onClick={() => setCreateStoreOpen(!createStoreOpen)}
          >
            <Plus className="h-4 w-4 mr-1.5" />
            {createStoreOpen ? "Скасувати" : "Створити магазин"}
          </Button>
        </div>

        {/* Create Store Foldout */}
        <AnimatedCollapse open={createStoreOpen}>
          <div className="pt-1 pb-1">
            <Card className="border-primary/50 bg-surface/90 shadow-sm backdrop-blur-xs">
              <CardHeader className="p-4 sm:p-5 border-b border-border">
                <CardTitle className="text-base">Новий магазин</CardTitle>
              </CardHeader>
              <CardContent className="p-4 sm:p-5">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!newStoreName.trim() || !newStoreLogin.trim() || !newStorePassword.trim()) {
                      return;
                    }
                    createStoreMutation.mutate({
                      name: newStoreName.trim(),
                      login: newStoreLogin.trim(),
                      password: newStorePassword.trim(),
                    });
                  }}
                  className="space-y-4"
                >
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-text-muted">Назва магазину</label>
                      <Input
                        value={newStoreName}
                        onChange={(e) => setNewStoreName(e.target.value)}
                        placeholder="Центральний"
                        maxLength={100}
                        required
                        className="h-11"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-text-muted">Логін для входу</label>
                      <Input
                        value={newStoreLogin}
                        onChange={(e) => setNewStoreLogin(e.target.value)}
                        placeholder="store_center"
                        maxLength={40}
                        autoCapitalize="none"
                        required
                        className="h-11 font-mono"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-text-muted">
                        Пароль (від 6 симв.)
                      </label>
                      <Input
                        type="password"
                        value={newStorePassword}
                        onChange={(e) => setNewStorePassword(e.target.value)}
                        placeholder="••••••••"
                        minLength={6}
                        required
                        className="h-11"
                      />
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <Button
                      type="submit"
                      variant="primary"
                      className="min-h-[44px]"
                      disabled={createStoreMutation.isPending}
                    >
                      {createStoreMutation.isPending ? "Створюю…" : "Додати магазин"}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </div>
        </AnimatedCollapse>

        {/* Active Stores List */}
        <Card>
          <CardHeader className="p-4 sm:p-5 border-b border-border">
            <CardTitle className="text-base flex items-center justify-between">
              <span>Список активних магазинів ({activeStores.length})</span>
              {storesLoading && <span className="text-xs text-text-muted">Завантаження…</span>}
            </CardTitle>
          </CardHeader>
          <div className="divide-y divide-border">
            {activeStores.length === 0 ? (
              <div className="p-8 text-center text-text-muted text-sm">
                Магазинів ще немає. Додайте перший магазин.
              </div>
            ) : (
              activeStores.map((s) => {
                const currentEditName = storeNameInput[s.id] ?? s.name;
                const currentEditLogin = storeLoginInput[s.id] ?? s.login;
                const currentNewPassword = storePasswordInput[s.id] ?? "";

                const hasChanges =
                  currentEditName.trim() !== s.name || currentEditLogin.trim() !== s.login;

                return (
                  <div key={s.id} className="p-4 sm:p-5 space-y-4 hover:bg-page/20 transition-colors">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                      {/* Name & Login Edit */}
                      <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="text-[11px] text-text-muted block mb-1">
                            Назва магазину
                          </label>
                          <Input
                            value={currentEditName}
                            onChange={(e) =>
                              setStoreNameInput((prev) => ({ ...prev, [s.id]: e.target.value }))
                            }
                            className="h-11 font-medium"
                            maxLength={100}
                          />
                        </div>

                        <div>
                          <label className="text-[11px] text-text-muted block mb-1">
                            Логін
                          </label>
                          <Input
                            value={currentEditLogin}
                            onChange={(e) =>
                              setStoreLoginInput((prev) => ({ ...prev, [s.id]: e.target.value }))
                            }
                            className="h-11 font-mono"
                            maxLength={40}
                            autoCapitalize="none"
                          />
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center space-x-2 shrink-0 self-end md:self-center">
                        <span className="text-xs text-text-muted mr-2">
                          Звітів: {s.reports_count}
                        </span>

                        {hasChanges && (
                          <Button
                            size="sm"
                            variant="primary"
                            className="min-h-[44px] animate-scale-in"
                            disabled={updateStoreMutation.isPending}
                            onClick={() =>
                              updateStoreMutation.mutate({
                                id: s.id,
                                name: currentEditName.trim(),
                                login: currentEditLogin.trim(),
                              })
                            }
                          >
                            Зберегти
                          </Button>
                        )}

                        <Button
                          size="icon"
                          variant="ghost"
                          className="text-destructive hover:bg-destructive/10 min-h-[44px] min-w-[44px]"
                          title="Видалити або перемістити в архів"
                          onClick={() => {
                            const hasReports = s.reports_count > 0;
                            setConfirmModal({
                              open: true,
                              title: hasReports
                                ? "Перемістити магазин в архів?"
                                : "Видалити магазин?",
                              description: hasReports
                                ? `«${s.name}» має звіти (${s.reports_count}). Магазин буде архівовано, звіти залишаться.`
                                : `«${s.name}» не має звітів. Видалити магазин разом із логіном?`,
                              actionLabel: hasReports ? "В архів" : "Видалити",
                              variant: "destructive",
                              onConfirm: () => deleteStoreMutation.mutate(s.id),
                            });
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    {/* Reset password row */}
                    <div className="pt-2 border-t border-border/50 flex flex-col sm:flex-row sm:items-center gap-3">
                      <div className="flex-1 max-w-sm">
                        <Input
                          type="password"
                          placeholder="Новий пароль для цього магазину"
                          value={currentNewPassword}
                          onChange={(e) =>
                            setStorePasswordInput((prev) => ({ ...prev, [s.id]: e.target.value }))
                          }
                          minLength={6}
                          className="h-10 text-xs"
                        />
                      </div>
                      {currentNewPassword.length > 0 && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="min-h-[40px] animate-scale-in"
                          disabled={
                            currentNewPassword.length < 6 ||
                            resetStorePasswordMutation.isPending
                          }
                          onClick={() =>
                            resetStorePasswordMutation.mutate({
                              id: s.id,
                              password: currentNewPassword,
                            })
                          }
                        >
                          <KeyRound className="h-3.5 w-3.5 mr-1" />
                          Змінити пароль
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </Card>

        {/* Archived Stores List */}
        {archivedStores.length > 0 && (
          <Card className="border-dashed border-border/80 bg-page/30">
            <CardHeader className="p-4 sm:p-5 border-b border-border">
              <CardTitle className="text-sm font-semibold text-text-muted flex items-center space-x-2">
                <Archive className="h-4 w-4" />
                <span>Архів магазинів ({archivedStores.length})</span>
              </CardTitle>
            </CardHeader>
            <div className="divide-y divide-border/60">
              {archivedStores.map((s) => (
                <div key={s.id} className="p-4 flex items-center justify-between gap-4">
                  <div>
                    <span className="text-sm font-medium text-text-muted line-through">
                      {s.name}
                    </span>
                    <span className="text-xs text-text-muted ml-2">
                      (логін: {s.login} · звітів: {s.reports_count})
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="min-h-[44px]"
                    onClick={() => restoreStoreMutation.mutate(s.id)}
                  >
                    <RotateCcw className="h-4 w-4 mr-1.5" />
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
