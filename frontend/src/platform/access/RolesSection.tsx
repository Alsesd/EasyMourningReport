/** Roles: named permission sets. Permissions come from every installed module. */

import { SkeletonRows } from "@/ui/Skeleton";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { accessApi } from "@/platform/access/api";
import type { OrganisationDTO, PermissionDTO, RoleDTO, RoleInputDTO } from "@/platform/api/types";
import { ukPlatform as uk } from "@/platform/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/Card";
import { Button } from "@/ui/Button";
import { Input } from "@/ui/Input";
import { AnimatedCollapse } from "@/ui/AnimatedCollapse";
import { useConfirm } from "@/ui/ConfirmDialog";
import { Pencil, Plus, Trash2 } from "lucide-react";
import type { AdminSectionProps } from "@/platform/modules";

type Scope = "platform" | "organisation";

function PermissionPicker({
  permissions,
  scope,
  selected,
  locked,
  onChange,
  idPrefix,
}: {
  permissions: PermissionDTO[];
  /** Only for a built-in administrator role, which holds every permission of one kind; other roles may hold any. */
  scope?: Scope;
  selected: string[];
  locked: boolean;
  onChange: (codes: string[]) => void;
  idPrefix: string;
}) {
  const groups = useMemo(() => {
    const byModule = new Map<string, { title: string; items: PermissionDTO[] }>();
    for (const p of permissions.filter((p) => !scope || p.scope === scope)) {
      const group = byModule.get(p.module) ?? { title: p.module_title, items: [] };
      group.items.push(p);
      byModule.set(p.module, group);
    }
    return [...byModule.entries()];
  }, [permissions, scope]);

  return (
    <fieldset className="space-y-3">
      <legend className="text-xs font-medium text-text-muted">{uk.access.permissionsLabel}</legend>
      {locked && <p className="text-xs text-text-muted">{uk.access.allPermissions}</p>}
      {groups.map(([module, group]) => (
        <div key={module} className="space-y-1.5">
          <p className="text-sm font-medium text-text-muted">{group.title}</p>
          {group.items.map((p) => {
            const id = `${idPrefix}-${p.code}`;
            return (
              <label key={p.code} htmlFor={id} className="flex items-start gap-3 min-h-[44px] py-1.5 cursor-pointer">
                <input
                  id={id}
                  type="checkbox"
                  className="mt-1 h-4 w-4"
                  disabled={locked}
                  checked={locked || selected.includes(p.code)}
                  onChange={(e) =>
                    onChange(e.target.checked ? [...selected, p.code] : selected.filter((c) => c !== p.code))
                  }
                />
                <span>
                  <span className="block text-sm text-text-main">{p.label}</span>
                  {p.description && <span className="block text-xs text-text-muted">{p.description}</span>}
                </span>
              </label>
            );
          })}
        </div>
      ))}
    </fieldset>
  );
}

function RoleForm({
  initial,
  role,
  permissions,
  organisations,
  pending,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: RoleInputDTO;
  role?: RoleDTO;
  permissions: PermissionDTO[];
  organisations: OrganisationDTO[];
  pending: boolean;
  submitLabel: string;
  onSubmit: (value: RoleInputDTO) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState<RoleInputDTO>(initial);
  const idPrefix = `role-${role?.id ?? "new"}`;
  const locked = Boolean(role?.all_permissions);

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        // A role is a plain set of permissions; the old "type" is only recorded: a role made for one division is
        // "organisation", any other "platform".
        onSubmit(role?.built_in ? value : { ...value, scope: value.organisation_id ? "organisation" : "platform" });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor={`${idPrefix}-name`} className="text-xs font-medium text-text-muted">{uk.access.roleName}</label>
          <Input
            id={`${idPrefix}-name`}
            value={value.name}
            onChange={(e) => setValue({ ...value, name: e.target.value })}
            maxLength={100}
            required
            className="h-11"
          />
        </div>
        {!role?.built_in && (
          <div className="space-y-1.5 sm:col-span-2">
            <label htmlFor={`${idPrefix}-org`} className="text-xs font-medium text-text-muted">{uk.access.roleOrganisation}</label>
            <select
              id={`${idPrefix}-org`}
              value={value.organisation_id ?? ""}
              onChange={(e) => setValue({ ...value, organisation_id: e.target.value ? Number(e.target.value) : null })}
              className="h-11 w-full rounded-control border border-border bg-surface px-3 text-sm text-text-main"
            >
              <option value="">{uk.access.allOrganisations}</option>
              {organisations.filter((o) => !o.archived).map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>
      <PermissionPicker
        permissions={permissions}
        scope={locked ? (value.scope as Scope) : undefined}
        selected={value.permissions ?? []}
        locked={locked}
        onChange={(codes) => setValue({ ...value, permissions: codes })}
        idPrefix={idPrefix}
      />
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

export default function RolesSection({ notify }: AdminSectionProps) {
  const queryClient = useQueryClient();
  const { ask, dialog } = useConfirm(uk.common.cancel);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const { data: roles = [], isLoading } = useQuery({ queryKey: ["access", "roles"], queryFn: () => accessApi.roles() });
  const { data: permissions = [] } = useQuery({ queryKey: ["access", "permissions"], queryFn: () => accessApi.permissions() });
  const { data: organisations = [] } = useQuery({ queryKey: ["access", "organisations"], queryFn: () => accessApi.organisations() });
  const labels = useMemo(() => new Map(permissions.map((p) => [p.code, p.label])), [permissions]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["access"] });
  const onError = (err: Error) => notify(err.message, "err");
  const create = useMutation({
    mutationFn: (v: RoleInputDTO) => accessApi.createRole(v),
    onSuccess: () => {
      refresh();
      setCreating(false);
      notify(uk.access.saved);
    },
    onError,
  });
  const update = useMutation({
    mutationFn: ({ id, v }: { id: number; v: RoleInputDTO }) => accessApi.updateRole(id, v),
    onSuccess: () => {
      refresh();
      setEditingId(null);
      notify(uk.access.saved);
    },
    onError,
  });
  const remove = useMutation({
    mutationFn: (id: number) => accessApi.deleteRole(id),
    onSuccess: (res) => {
      refresh();
      notify(res.message);
    },
    onError,
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button className="min-h-[44px]" onClick={() => setCreating(!creating)}>
          <Plus className="h-4 w-4 mr-1.5" />
          {creating ? uk.common.cancel : uk.access.addRole}
        </Button>
      </div>

      <AnimatedCollapse open={creating}>
        {creating && (
          <Card className="border-t-2 border-t-primary">
            <CardHeader className="p-4 sm:p-5 border-b border-border">
              <CardTitle className="text-base">{uk.access.newRole}</CardTitle>
            </CardHeader>
            <CardContent className="p-4 sm:p-5">
              <RoleForm
                initial={{ name: "", scope: "organisation", organisation_id: null, permissions: [] }}
                permissions={permissions}
                organisations={organisations}
                pending={create.isPending}
                submitLabel={uk.access.addRole}
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
            <SkeletonRows rows={3} className="border-t-0" />
          ) : (
            roles.map((role) => {
              const editing = editingId === role.id;
              return (
                <div key={role.id} className="space-y-3 px-1 py-4" data-role-id={role.id}>
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-text-main">{role.name}</span>
                        {role.built_in && (
                          <span className="rounded-control border border-border px-2 py-0.5 text-xs text-text-muted">
                            {uk.access.builtIn}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-text-muted mt-0.5">
                        {role.scope === "platform" ? uk.access.scopePlatform : uk.access.scopeOrganisation}
                        {role.organisation_name ? `, ${role.organisation_name}` : ""}, {uk.access.roleUsers(role.user_count ?? 0)}
                      </p>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {(role.permissions ?? []).map((code) => (
                          <span key={code} className="rounded-control bg-primary-soft px-2 py-0.5 text-xs text-primary">
                            {labels.get(code) ?? code}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="outline"
                        size="sm"
                        className="min-h-[44px]"
                        aria-expanded={editing}
                        onClick={() => setEditingId(editing ? null : role.id)}
                      >
                        <Pencil className="h-4 w-4 mr-1.5" />
                        {editing ? uk.common.close : uk.common.edit}
                      </Button>
                      {!role.built_in && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive hover:bg-destructive/10 min-h-[44px] min-w-[44px]"
                          aria-label={`${uk.access.deleteRole} ${role.name}`}
                          title={uk.access.deleteRole}
                          onClick={() =>
                            ask({
                              title: uk.access.deleteRole,
                              description: uk.access.confirmDeleteRole(role.name),
                              actionLabel: uk.common.delete,
                              onConfirm: () => remove.mutate(role.id),
                            })
                          }
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                  {editing && (
                    <div className="border-l-2 border-primary bg-surface-raised/60 p-4">
                      <RoleForm
                        role={role}
                        initial={{
                          name: role.name,
                          scope: role.scope,
                          organisation_id: role.organisation_id ?? null,
                          permissions: role.permissions ?? [],
                        }}
                        permissions={permissions}
                        organisations={organisations}
                        pending={update.isPending}
                        submitLabel={uk.common.save}
                        onSubmit={(v) => update.mutate({ id: role.id, v })}
                        onCancel={() => setEditingId(null)}
                      />
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
