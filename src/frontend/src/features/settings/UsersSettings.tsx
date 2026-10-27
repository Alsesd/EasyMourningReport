import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/shared/api/client";
import type {
  MutationDTO,
  StoreDTO,
  UserCreateDTO,
  UserDTO,
  UserUpdateDTO,
} from "@/shared/api/types";
import { AnimatedCollapse } from "@/shared/components/ui/AnimatedCollapse";
import { Button } from "@/shared/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/Card";
import { Input } from "@/shared/components/ui/Input";
import { cn } from "@/shared/lib/utils";
import {
  Check,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import { permissionCatalog, permissionLabel } from "@/features/workspace/permissions";
import { ConfirmDialog } from "./ConfirmDialog";
import type { ConfirmModalState, Notify } from "./types";

interface Props {
  notify: Notify;
}

interface UserFormState {
  name: string;
  login: string;
  password: string;
  departmentId: string;
  departmentName: string;
  permissions: string[];
}

const emptyForm = (): UserFormState => ({
  name: "",
  login: "",
  password: "",
  departmentId: "",
  departmentName: "",
  permissions: ["sales_report"],
});

function PermissionPicker({
  values,
  onToggle,
}: {
  values: string[];
  onToggle: (code: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
      {permissionCatalog.map((permission) => {
        const Icon = permission.icon;
        const checked = values.includes(permission.code);
        return (
          <label
            key={permission.code}
            className={cn(
              "flex cursor-pointer items-start gap-2.5 rounded-control border p-3 text-xs transition-all",
              checked
                ? "border-primary/50 bg-primary/5 text-text-main shadow-2xs"
                : "border-border/70 bg-page/30 text-text-muted hover:border-border hover:bg-page/60"
            )}
          >
            <input
              type="checkbox"
              checked={checked}
              onChange={() => onToggle(permission.code)}
              className="sr-only"
            />
            <span
              className={cn(
                "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                checked ? "border-primary bg-primary text-primary-fg" : "border-border bg-surface"
              )}
            >
              {checked && <Check className="h-3 w-3" />}
            </span>
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 font-medium">
                <Icon className="h-3.5 w-3.5 shrink-0" />
                {permission.shortLabel}
              </span>
              <span className="mt-0.5 block leading-relaxed opacity-80">
                {permission.label}
              </span>
            </span>
          </label>
        );
      })}
    </div>
  );
}

function UserFormFields({
  form,
  setForm,
  stores,
  passwordRequired,
}: {
  form: UserFormState;
  setForm: React.Dispatch<React.SetStateAction<UserFormState>>;
  stores: StoreDTO[];
  passwordRequired: boolean;
}) {
  const set = <K extends keyof UserFormState>(key: K, value: UserFormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));
  const activeStores = stores.filter((store) => !store.archived);
  const creatingDepartment = form.departmentId === "new";

  const togglePermission = (code: string) =>
    setForm((prev) => ({
      ...prev,
      permissions: prev.permissions.includes(code)
        ? prev.permissions.filter((permission) => permission !== code)
        : [...prev.permissions, code],
    }));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-text-muted">Ім’я та прізвище</label>
          <Input
            value={form.name}
            onChange={(event) => set("name", event.target.value)}
            placeholder="Олена Петренко"
            maxLength={100}
            required
            className="h-11"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-text-muted">Логін</label>
          <Input
            value={form.login}
            onChange={(event) => set("login", event.target.value)}
            placeholder="olena.p"
            maxLength={40}
            required
            autoCapitalize="none"
            className="h-11 font-mono"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-text-muted">
            {passwordRequired ? "Пароль (від 6 символів)" : "Новий пароль (необов’язково)"}
          </label>
          <Input
            type="password"
            value={form.password}
            onChange={(event) => set("password", event.target.value)}
            placeholder={passwordRequired ? "••••••••" : "Залишити без змін"}
            minLength={passwordRequired ? 6 : undefined}
            required={passwordRequired}
            className="h-11"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-text-muted">Відділ</label>
          <select
            value={form.departmentId}
            onChange={(event) => set("departmentId", event.target.value)}
            required
            className="h-11 w-full rounded-control border border-border bg-surface px-3 text-sm text-text-main focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25"
          >
            <option value="">Оберіть відділ…</option>
            {activeStores.map((store) => (
              <option key={store.id} value={String(store.id)}>
                {store.name}
              </option>
            ))}
            <option value="new">+ Створити новий відділ</option>
          </select>
          {creatingDepartment && (
            <Input
              value={form.departmentName}
              onChange={(event) => set("departmentName", event.target.value)}
              placeholder="Назва нового відділу"
              maxLength={100}
              required
              className="mt-2 h-10"
            />
          )}
        </div>
      </div>

      <div>
        <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-text-muted">
          <ShieldCheck className="h-3.5 w-3.5" />
          Права доступу
        </p>
        <PermissionPicker values={form.permissions} onToggle={togglePermission} />
      </div>
    </div>
  );
}

export default function UsersSettings({ notify }: Props) {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<UserFormState>(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<UserFormState>(emptyForm);
  const [confirmModal, setConfirmModal] = useState<ConfirmModalState>({
    open: false,
    title: "",
    description: "",
    actionLabel: "",
    variant: "destructive",
    onConfirm: () => {},
  });

  const { data: usersData, isLoading: usersLoading } = useQuery({
    queryKey: ["adminUsers"],
    queryFn: () => api.get<UserDTO[]>("/api/v1/admin/users"),
  });
  const { data: storesData } = useQuery({
    queryKey: ["adminStores"],
    queryFn: () => api.get<StoreDTO[]>("/api/v1/admin/stores"),
  });

  const users = useMemo(() => usersData || [], [usersData]);
  const stores = useMemo(() => storesData || [], [storesData]);
  const adminUsers = users.filter((user) => user.role === "admin");
  const storeUsers = users.filter((user) => user.role === "store");

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["adminUsers"] });
    queryClient.invalidateQueries({ queryKey: ["adminStores"] });
  };

  const createMutation = useMutation({
    mutationFn: (payload: UserCreateDTO) =>
      api.post<UserDTO>("/api/v1/admin/users", payload),
    onSuccess: (created) => {
      invalidate();
      setCreateForm(emptyForm());
      setCreateOpen(false);
      notify(`Користувача «${created.name}» створено.`);
    },
    onError: (error: Error) => notify(error.message || "Не вдалося створити користувача.", "err"),
  });

  const updateMutation = useMutation({
    mutationFn: (payload: { id: number; data: UserUpdateDTO }) =>
      api.put<UserDTO>(`/api/v1/admin/users/${payload.id}`, payload.data),
    onSuccess: (updated) => {
      invalidate();
      setEditingId(null);
      notify(`Дані користувача «${updated.name}» оновлено.`);
    },
    onError: (error: Error) => notify(error.message || "Не вдалося оновити користувача.", "err"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete<MutationDTO>(`/api/v1/admin/users/${id}`),
    onSuccess: (response) => {
      invalidate();
      notify(response?.message || "Користувача видалено.");
    },
    onError: (error: Error) => notify(error.message || "Не вдалося видалити користувача.", "err"),
  });

  const payloadFromForm = (form: UserFormState, passwordRequired: boolean) => {
    const permissions = permissionCatalog
      .map((permission) => permission.code)
      .filter((code) => form.permissions.includes(code));
    if (permissions.length === 0) {
      notify("Оберіть хоча б одне право доступу.", "err");
      return null;
    }
    if (!form.departmentId) {
      notify("Оберіть відділ або створіть новий.", "err");
      return null;
    }
    if (form.departmentId === "new" && !form.departmentName.trim()) {
      notify("Введіть назву нового відділу.", "err");
      return null;
    }
    if (passwordRequired && form.password.length < 6) {
      notify("Пароль має містити щонайменше 6 символів.", "err");
      return null;
    }
    return {
      name: form.name.trim(),
      login: form.login.trim(),
      password: form.password || undefined,
      department_id: form.departmentId === "new" ? null : Number(form.departmentId),
      department_name: form.departmentId === "new" ? form.departmentName.trim() : null,
      permissions,
    };
  };

  const startEditing = (user: UserDTO) => {
    setEditingId(user.id);
    setEditForm({
      name: user.name,
      login: user.login,
      password: "",
      departmentId: user.department_id ? String(user.department_id) : "",
      departmentName: "",
      permissions: user.permissions ?? [],
    });
  };

  const removeUser = (user: UserDTO) => {
    setConfirmModal({
      open: true,
      title: "Видалити користувача?",
      description: `Обліковий запис «${user.name}» (${user.login}) буде видалено. Цю дію не можна скасувати.`,
      actionLabel: "Видалити",
      variant: "destructive",
      onConfirm: () => deleteMutation.mutate(user.id),
    });
  };

  return (
    <>
      <div className="space-y-6 animate-fade-in">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-text-muted">
            Керуйте людьми, відділами та правами доступу. Кожен користувач бачить
            лише дозволені йому розділи.
          </p>
          <Button
            variant="primary"
            className="min-h-[44px] shrink-0"
            onClick={() => setCreateOpen((open) => !open)}
          >
            {createOpen ? <X className="mr-1.5 h-4 w-4" /> : <UserPlus className="mr-1.5 h-4 w-4" />}
            {createOpen ? "Скасувати" : "Створити користувача"}
          </Button>
        </div>

        <AnimatedCollapse open={createOpen}>
          <Card className="border-primary/50 bg-surface/90 shadow-sm backdrop-blur-xs">
            <CardHeader className="border-b border-border p-4 sm:p-5">
              <CardTitle className="flex items-center gap-2 text-base">
                <Plus className="h-4 w-4 text-primary" />
                Новий користувач
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 sm:p-5">
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const payload = payloadFromForm(createForm, true);
                  if (!payload) return;
                  createMutation.mutate(payload as UserCreateDTO);
                }}
                className="space-y-4"
              >
                <UserFormFields
                  form={createForm}
                  setForm={setCreateForm}
                  stores={stores}
                  passwordRequired
                />
                <div className="flex justify-end">
                  <Button type="submit" disabled={createMutation.isPending}>
                    {createMutation.isPending ? "Створюю…" : "Створити користувача"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </AnimatedCollapse>

        <Card>
          <CardHeader className="border-b border-border p-4 sm:p-5">
            <CardTitle className="flex items-center justify-between text-base">
              <span>Користувачі ({users.length})</span>
              {usersLoading && <span className="text-xs font-normal text-text-muted">Завантаження…</span>}
            </CardTitle>
          </CardHeader>
          <div className="divide-y divide-border">
            {users.length === 0 && !usersLoading && (
              <div className="p-8 text-center text-sm text-text-muted">
                Користувачів ще немає.
              </div>
            )}
            {adminUsers.map((user) => (
              <div key={user.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold">{user.name}</span>
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                      Адміністратор
                    </span>
                  </div>
                  <p className="mt-0.5 font-mono text-xs text-text-muted">{user.login}</p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {(user.permissions ?? []).map((code) => (
                    <span
                      key={code}
                      className="rounded-full border border-border bg-page/60 px-2 py-0.5 text-[10px] text-text-muted"
                    >
                      {permissionLabel(code)}
                    </span>
                  ))}
                </div>
              </div>
            ))}
            {storeUsers.map((user) => {
              const editing = editingId === user.id;
              return (
                <div key={user.id} className="p-4 sm:p-5">
                  {editing ? (
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        const payload = payloadFromForm(editForm, false);
                        if (!payload) return;
                        updateMutation.mutate({
                          id: user.id,
                          data: payload as UserUpdateDTO,
                        });
                      }}
                      className="space-y-4"
                    >
                      <UserFormFields
                        form={editForm}
                        setForm={setEditForm}
                        stores={stores}
                        passwordRequired={false}
                      />
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button type="button" variant="ghost" onClick={() => setEditingId(null)}>
                          Скасувати
                        </Button>
                        <Button type="submit" disabled={updateMutation.isPending}>
                          {updateMutation.isPending ? "Зберігаю…" : "Зберегти зміни"}
                        </Button>
                      </div>
                    </form>
                  ) : (
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex min-w-0 items-start gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                          {user.name.slice(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{user.name}</p>
                          <p className="font-mono text-xs text-text-muted">{user.login}</p>
                          <p className="mt-1 text-[11px] text-text-muted">
                            {user.department_name || "Відділ не вказано"}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-1 flex-wrap gap-1.5 sm:justify-center">
                        {(user.permissions ?? []).map((code) => (
                          <span
                            key={code}
                            className="rounded-full border border-primary/20 bg-primary/5 px-2 py-0.5 text-[10px] font-medium text-primary"
                          >
                            {permissionLabel(code)}
                          </span>
                        ))}
                      </div>
                      <div className="flex items-center gap-1.5 self-end sm:self-start">
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`Редагувати ${user.name}`}
                          title="Редагувати"
                          onClick={() => startEditing(user)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="text-destructive hover:bg-destructive/10"
                          aria-label={`Видалити ${user.name}`}
                          title="Видалити"
                          onClick={() => removeUser(user)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>

        <p className="text-xs text-text-muted">
          Порада: щоб створити відділ разом із першим користувачем, оберіть
          «Створити новий відділ» у полі «Відділ».
        </p>
      </div>

      <ConfirmDialog
        state={confirmModal}
        onOpenChange={(open) => setConfirmModal((prev) => ({ ...prev, open }))}
      />
    </>
  );
}
