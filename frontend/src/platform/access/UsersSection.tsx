/** User accounts: platform managers see everyone, organisation managers only their own organisation. */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/platform/auth/AuthContext";
import { accessApi, P } from "@/platform/access/api";
import type { OrganisationDTO, RoleDTO, UserDTO } from "@/platform/api/types";
import { ukPlatform as uk } from "@/platform/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/Card";
import { Button } from "@/ui/Button";
import { Input } from "@/ui/Input";
import { AnimatedCollapse } from "@/ui/AnimatedCollapse";
import { useConfirm } from "@/ui/ConfirmDialog";
import { KeyRound, Pencil, Plus, Trash2 } from "lucide-react";
import type { AdminSectionProps } from "@/platform/modules";
import { MIN_PASSWORD_LENGTH, PASSWORD_RULE, isAcceptablePassword } from "@/platform/passwordPolicy";

const PLATFORM = "platform";

interface FormValue {
  login: string;
  full_name: string;
  password: string;
  organisation_id: number | null;
  role_ids: number[];
  active: boolean;
}

function rolesFor(roles: RoleDTO[], organisationId: number | null, platformManager: boolean): RoleDTO[] {
  if (!platformManager) return roles; // the API already returns only what an org manager may assign
  return roles.filter((r) =>
    organisationId === null
      ? r.scope === "platform"
      : r.scope === "organisation" && (r.organisation_id == null || r.organisation_id === organisationId),
  );
}

function UserForm({
  initial,
  organisations,
  roles,
  platformManager,
  withPassword,
  submitLabel,
  pending,
  onSubmit,
  onCancel,
}: {
  initial: FormValue;
  organisations: OrganisationDTO[];
  roles: RoleDTO[];
  platformManager: boolean;
  withPassword: boolean;
  submitLabel: string;
  pending: boolean;
  onSubmit: (value: FormValue) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState<FormValue>(initial);
  const offered = rolesFor(roles, value.organisation_id, platformManager);
  const idPrefix = `user-${initial.login || "new"}`;

  const setOrganisation = (raw: string) => {
    const organisation_id = raw === PLATFORM ? null : Number(raw);
    const keep = new Set(rolesFor(roles, organisation_id, platformManager).map((r) => r.id));
    setValue((v) => ({ ...v, organisation_id, role_ids: v.role_ids.filter((id) => keep.has(id)) }));
  };

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(value);
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor={`${idPrefix}-login`} className="text-xs font-medium text-text-muted">{uk.access.loginLabel}</label>
          <Input
            id={`${idPrefix}-login`}
            value={value.login}
            onChange={(e) => setValue({ ...value, login: e.target.value })}
            minLength={2}
            maxLength={40}
            required
            autoComplete="off"
            className="h-11"
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor={`${idPrefix}-name`} className="text-xs font-medium text-text-muted">{uk.access.fullNameLabel}</label>
          <Input
            id={`${idPrefix}-name`}
            value={value.full_name}
            onChange={(e) => setValue({ ...value, full_name: e.target.value })}
            maxLength={100}
            className="h-11"
          />
        </div>
        {withPassword && (
          <div className="space-y-1.5">
            <label htmlFor={`${idPrefix}-password`} className="text-xs font-medium text-text-muted">{uk.access.passwordLabel}</label>
            <Input
              id={`${idPrefix}-password`}
              type="password"
              value={value.password}
              onChange={(e) => setValue({ ...value, password: e.target.value })}
              minLength={MIN_PASSWORD_LENGTH}
              required
              autoComplete="new-password"
              aria-describedby={`${idPrefix}-password-rule`}
              className="h-11"
            />
            <p id={`${idPrefix}-password-rule`} className="text-xs text-text-muted">{PASSWORD_RULE}</p>
          </div>
        )}
        {platformManager && (
          <div className="space-y-1.5">
            <label htmlFor={`${idPrefix}-org`} className="text-xs font-medium text-text-muted">{uk.access.organisationLabel}</label>
            <select
              id={`${idPrefix}-org`}
              value={value.organisation_id ?? PLATFORM}
              onChange={(e) => setOrganisation(e.target.value)}
              className="h-11 w-full rounded-control border border-border bg-surface px-3 text-sm text-text-main"
            >
              <option value={PLATFORM}>{uk.access.platformStaff}</option>
              {organisations.filter((o) => !o.archived || o.id === initial.organisation_id).map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      <fieldset className="space-y-2">
        <legend className="text-xs font-medium text-text-muted">{uk.access.rolesLabel}</legend>
        {offered.length === 0 ? (
          <p className="text-sm text-text-muted">{uk.access.noRoles}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {offered.map((role) => {
              const checked = value.role_ids.includes(role.id);
              return (
                <label
                  key={role.id}
                  className={`flex items-center gap-2 rounded-control border px-3 min-h-[44px] text-sm cursor-pointer ${
                    checked ? "border-primary bg-primary/10 text-text-main" : "border-border text-text-muted"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={checked}
                    onChange={(e) =>
                      setValue({
                        ...value,
                        role_ids: e.target.checked
                          ? [...value.role_ids, role.id]
                          : value.role_ids.filter((id) => id !== role.id),
                      })
                    }
                  />
                  {role.name}
                </label>
              );
            })}
          </div>
        )}
      </fieldset>

      <label className="flex items-center gap-2 text-sm text-text-main min-h-[44px] cursor-pointer">
        <input
          type="checkbox"
          className="h-4 w-4"
          checked={value.active}
          onChange={(e) => setValue({ ...value, active: e.target.checked })}
        />
        {uk.access.activeLabel}
      </label>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" className="min-h-[44px]" disabled={pending}>
          {pending ? uk.common.loading : submitLabel}
        </Button>
        <Button type="button" variant="ghost" className="min-h-[44px]" onClick={onCancel}>
          {uk.common.cancel}
        </Button>
      </div>
    </form>
  );
}

function PasswordReset({ user, notify }: { user: UserDTO; notify: AdminSectionProps["notify"] }) {
  const [password, setPassword] = useState("");
  const reset = useMutation({
    mutationFn: () => accessApi.setUserPassword(user.id, password),
    onSuccess: (res) => {
      setPassword("");
      notify(res.message);
    },
    onError: (err: Error) => notify(err.message, "err"),
  });
  return (
    <form
      className="flex flex-col sm:flex-row gap-2 sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        if (isAcceptablePassword(password)) reset.mutate();
      }}
    >
      <div className="flex-1 space-y-1.5">
        <label htmlFor={`reset-${user.id}`} className="text-xs font-medium text-text-muted">{uk.access.resetPassword}</label>
        <Input
          id={`reset-${user.id}`}
          type="password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          aria-describedby={`reset-${user.id}-rule`}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="h-11"
        />
        <p id={`reset-${user.id}-rule`} className="text-xs text-text-muted">{PASSWORD_RULE}</p>
      </div>
      <Button type="submit" variant="outline" className="min-h-[44px]" disabled={!isAcceptablePassword(password) || reset.isPending}>
        <KeyRound className="h-4 w-4 mr-1.5" />
        {uk.access.resetPasswordButton}
      </Button>
    </form>
  );
}

export default function UsersSection({ notify }: AdminSectionProps) {
  const { can, session } = useAuth();
  const platformManager = can(P.usersManage);
  const queryClient = useQueryClient();
  const { ask, dialog } = useConfirm(uk.common.cancel);
  const [filter, setFilter] = useState<string>("all");
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const { data: users = [], isLoading } = useQuery({ queryKey: ["access", "users"], queryFn: () => accessApi.users() });
  const { data: roles = [] } = useQuery({ queryKey: ["access", "roles"], queryFn: () => accessApi.roles() });
  const { data: organisations = [] } = useQuery({
    queryKey: ["access", "organisations"],
    queryFn: () => accessApi.organisations(),
    enabled: platformManager,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["access"] });
  const onError = (err: Error) => notify(err.message, "err");

  const create = useMutation({
    mutationFn: (v: FormValue) => accessApi.createUser(v),
    onSuccess: (u) => {
      refresh();
      setCreating(false);
      notify(`${uk.access.saved} ${u.login}`);
    },
    onError,
  });
  const update = useMutation({
    mutationFn: ({ id, v }: { id: number; v: FormValue }) =>
      accessApi.updateUser(id, {
        login: v.login,
        full_name: v.full_name,
        organisation_id: v.organisation_id,
        role_ids: v.role_ids,
        active: v.active,
      }),
    onSuccess: () => {
      refresh();
      setEditingId(null);
      notify(uk.access.saved);
    },
    onError,
  });
  const remove = useMutation({
    mutationFn: (id: number) => accessApi.deleteUser(id),
    onSuccess: (res) => {
      refresh();
      notify(res.message);
    },
    onError,
  });

  const visible = useMemo(() => {
    if (filter === "all") return users;
    if (filter === PLATFORM) return users.filter((u) => !u.organisation);
    return users.filter((u) => u.organisation?.id === Number(filter));
  }, [users, filter]);

  const defaultOrganisation =
    filter !== "all" && filter !== PLATFORM ? Number(filter) : session?.organisation?.id ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3 sm:items-end justify-between">
        {platformManager ? (
          <div className="space-y-1.5">
            <label htmlFor="users-filter" className="text-xs font-medium text-text-muted">{uk.access.organisationLabel}</label>
            <select
              id="users-filter"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="h-11 w-full sm:w-72 rounded-control border border-border bg-surface px-3 text-sm text-text-main"
            >
              <option value="all">{uk.access.allUsers}</option>
              <option value={PLATFORM}>{uk.access.platformStaff}</option>
              {organisations.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                  {o.archived ? ` (${uk.access.archived})` : ""}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <p className="text-sm text-text-muted">{session?.organisation?.name}</p>
        )}
        <Button className="min-h-[44px]" onClick={() => setCreating(!creating)}>
          <Plus className="h-4 w-4 mr-1.5" />
          {creating ? uk.common.cancel : uk.access.addUser}
        </Button>
      </div>

      <AnimatedCollapse open={creating}>
        {creating && (
          <Card className="border-t-2 border-t-primary">
            <CardHeader className="p-4 sm:p-5 border-b border-border">
              <CardTitle className="text-base">{uk.access.newUser}</CardTitle>
            </CardHeader>
            <CardContent className="p-4 sm:p-5">
              <UserForm
                initial={{ login: "", full_name: "", password: "", organisation_id: defaultOrganisation, role_ids: [], active: true }}
                organisations={organisations}
                roles={roles}
                platformManager={platformManager}
                withPassword
                submitLabel={uk.access.addUser}
                pending={create.isPending}
                onSubmit={(v) => create.mutate(v)}
                onCancel={() => setCreating(false)}
              />
            </CardContent>
          </Card>
        )}
      </AnimatedCollapse>

      <div className="ledger">
        <div className="divide-y divide-border">
          {isLoading ? (
            <p className="p-6 text-sm text-text-muted">{uk.common.loading}</p>
          ) : visible.length === 0 ? (
            <p className="p-6 text-sm text-text-muted text-center">{uk.access.noUsers}</p>
          ) : (
            visible.map((user) => {
              const editing = editingId === user.id;
              const isSelf = user.id === session?.user_id;
              return (
                <div key={user.id} className="space-y-4 px-1 py-4" data-user-id={user.id}>
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-text-main">{user.login}</span>
                        {!user.active && (
                          <span className="text-xs font-medium text-destructive">
                            {uk.access.inactive}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-text-muted mt-0.5">
                        {[user.full_name, user.organisation?.name ?? uk.access.noOrganisation].filter(Boolean).join(", ")}
                      </p>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {(user.role_names ?? []).map((name) => (
                          <span key={name} className="rounded-control bg-primary-soft px-2 py-0.5 text-xs text-primary">{name}</span>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="outline"
                        size="sm"
                        className="min-h-[44px]"
                        aria-expanded={editing}
                        onClick={() => setEditingId(editing ? null : user.id)}
                      >
                        <Pencil className="h-4 w-4 mr-1.5" />
                        {editing ? uk.common.close : uk.common.edit}
                      </Button>
                      {!isSelf && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive hover:bg-destructive/10 min-h-[44px] min-w-[44px]"
                          aria-label={`${uk.access.deleteUser} ${user.login}`}
                          title={uk.access.deleteUser}
                          onClick={() =>
                            ask({
                              title: uk.access.deleteUser,
                              description: uk.access.confirmDeleteUser(user.login),
                              actionLabel: uk.common.delete,
                              onConfirm: () => remove.mutate(user.id),
                            })
                          }
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                  {editing && (
                    <div className="border-l-2 border-primary bg-surface-raised/60 p-4 space-y-5">
                      <UserForm
                        initial={{
                          login: user.login,
                          full_name: user.full_name ?? "",
                          password: "",
                          organisation_id: user.organisation?.id ?? null,
                          role_ids: user.role_ids ?? [],
                          active: user.active,
                        }}
                        organisations={organisations}
                        roles={roles}
                        platformManager={platformManager}
                        withPassword={false}
                        submitLabel={uk.common.save}
                        pending={update.isPending}
                        onSubmit={(v) => update.mutate({ id: user.id, v })}
                        onCancel={() => setEditingId(null)}
                      />
                      <div className="border-t border-border pt-4">
                        <PasswordReset user={user} notify={notify} />
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
      {dialog}
    </div>
  );
}
