/**
 * Create an organisation, optionally with its employees: new accounts (login, password, role) and/or existing
 * accounts moved over from other organisations. Everything about employees is optional and can be done later
 * in «Користувачі». Employees go through the same endpoints, and so the same permission checks, as that section.
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dices, Eye, EyeOff, Plus, X } from "lucide-react";
import { accessApi } from "@/platform/access/api";
import type { OrganisationDTO, RoleDTO } from "@/platform/api/types";
import { ukPlatform as uk } from "@/platform/i18n";
import { MIN_PASSWORD_LENGTH } from "@/platform/passwordPolicy";
import { Button } from "@/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/Card";
import { Input } from "@/ui/Input";

interface Employee {
  key: number;
  login: string;
  password: string;
  roleId: number | null;
  show: boolean;
}

export interface CreateOutcome {
  organisation: OrganisationDTO;
  created: number;
  moved: number;
  failures: string[];
}

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";

/** A readable random password (no look-alike characters) that satisfies the minimum length. */
export function generatePassword(length = 12): string {
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

const sharedOrganisationRoles = (roles: RoleDTO[]) => roles.filter((r) => r.scope === "organisation" && r.organisation_id == null);

export function NewOrganisationForm({
  canManageUsers,
  onDone,
  onCancel,
}: {
  canManageUsers: boolean;
  onDone: (outcome: CreateOutcome) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [nextKey, setNextKey] = useState(1);
  const [moveIds, setMoveIds] = useState<Set<number>>(new Set());
  const [showExisting, setShowExisting] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: roles = [] } = useQuery({ queryKey: ["access", "roles", "all"], queryFn: () => accessApi.roles(), enabled: canManageUsers });
  const { data: users = [] } = useQuery({
    queryKey: ["access", "users", "all"],
    queryFn: () => accessApi.users(),
    enabled: canManageUsers && showExisting,
  });
  const offered = useMemo(() => sharedOrganisationRoles(roles), [roles]);
  const defaultRole = offered.find((r) => r.key === "store") ?? offered[0];
  const movable = users.filter((u) => u.organisation);

  const patch = (key: number, change: Partial<Employee>) =>
    setEmployees((list) => list.map((e) => (e.key === key ? { ...e, ...change } : e)));

  const addEmployee = () => {
    setEmployees((list) => [...list, { key: nextKey, login: "", password: "", roleId: defaultRole?.id ?? null, show: false }]);
    setNextKey((k) => k + 1);
  };

  const toggleMove = (id: number) =>
    setMoveIds((ids) => {
      const next = new Set(ids);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const submit = async () => {
    setError(null);
    const orgName = name.trim();
    if (!orgName) return;
    const rows = employees.filter((e) => e.login.trim() || e.password); // a blank row is simply ignored
    const seen = new Set<string>();
    for (const e of rows) {
      const login = e.login.trim().toLocaleLowerCase("uk-UA");
      if (login.length < 2) return setError(uk.access.employeeLoginShort);
      if (e.password.length < MIN_PASSWORD_LENGTH) return setError(uk.access.employeePasswordShort);
      if (seen.has(login)) return setError(uk.access.employeeDuplicate(e.login.trim()));
      seen.add(login);
    }

    setPending(true);
    try {
      const organisation = await accessApi.createOrganisation({ name: orgName, first_user: null });
      const failures: string[] = [];
      let created = 0;
      let moved = 0;
      for (const e of rows) {
        try {
          await accessApi.createUser({
            login: e.login.trim(),
            password: e.password,
            full_name: "",
            organisation_id: organisation.id,
            role_ids: e.roleId != null ? [e.roleId] : [],
            active: true,
          });
          created += 1;
        } catch (err) {
          failures.push(`${e.login.trim()}: ${(err as Error).message}`);
        }
      }
      const sharedIds = new Set(offered.map((r) => r.id));
      for (const id of moveIds) {
        const user = users.find((u) => u.id === id);
        if (!user) continue;
        // Roles that belong only to the old organisation cannot follow; fall back to the default role.
        const kept = (user.role_ids ?? []).filter((r) => sharedIds.has(r));
        try {
          await accessApi.updateUser(id, {
            login: user.login,
            full_name: user.full_name,
            organisation_id: organisation.id,
            role_ids: kept.length ? kept : defaultRole ? [defaultRole.id] : [],
            active: user.active,
          });
          moved += 1;
        } catch (err) {
          failures.push(`${user.login}: ${(err as Error).message}`);
        }
      }
      onDone({ organisation, created, moved, failures });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  };

  return (
    <Card className="border-t-2 border-t-primary">
      <CardHeader className="border-b border-border p-4 sm:p-5">
        <CardTitle className="text-base">{uk.access.newOrganisation}</CardTitle>
      </CardHeader>
      <CardContent className="p-4 sm:p-5">
        <form
          className="space-y-6"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {error && (
            <p role="alert" className="border-l-2 border-destructive bg-destructive/10 px-3.5 py-3 text-sm text-destructive">
              {error}
            </p>
          )}

          <div className="space-y-1.5">
            <label htmlFor="org-name" className="text-xs font-medium text-text-muted">{uk.access.organisationName}</label>
            <Input id="org-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required autoFocus className="h-11" />
          </div>

          {canManageUsers && (
            <fieldset className="space-y-3">
              <legend className="text-sm font-semibold text-text-main">{uk.access.employeesTitle}</legend>
              <p className="text-sm text-text-muted">{uk.access.employeesHint}</p>

              {employees.map((e, index) => (
                <div key={e.key} className="grid gap-3 border border-border bg-surface-raised p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1fr)_auto] sm:items-end">
                  <div className="space-y-1.5">
                    <label htmlFor={`emp-login-${e.key}`} className="text-xs font-medium text-text-muted">{uk.access.loginLabel}</label>
                    <Input
                      id={`emp-login-${e.key}`}
                      value={e.login}
                      onChange={(ev) => patch(e.key, { login: ev.target.value })}
                      maxLength={40}
                      autoComplete="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      autoFocus={index === employees.length - 1 && index > 0}
                      className="h-11"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor={`emp-password-${e.key}`} className="text-xs font-medium text-text-muted">{uk.access.passwordLabel}</label>
                    <div className="flex gap-1.5">
                      <Input
                        id={`emp-password-${e.key}`}
                        type={e.show ? "text" : "password"}
                        value={e.password}
                        onChange={(ev) => patch(e.key, { password: ev.target.value })}
                        autoComplete="new-password"
                        className="h-11 min-w-0 flex-1"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="min-h-[44px] min-w-[44px]"
                        aria-label={e.show ? uk.auth.hidePassword : uk.auth.showPassword}
                        aria-pressed={e.show}
                        onClick={() => patch(e.key, { show: !e.show })}
                      >
                        {e.show ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="min-h-[44px] min-w-[44px]"
                        aria-label={uk.access.generatePassword}
                        title={uk.access.generatePassword}
                        onClick={() => patch(e.key, { password: generatePassword(), show: true })}
                      >
                        <Dices className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor={`emp-role-${e.key}`} className="text-xs font-medium text-text-muted">{uk.access.employeeRole}</label>
                    <select
                      id={`emp-role-${e.key}`}
                      value={e.roleId ?? ""}
                      onChange={(ev) => patch(e.key, { roleId: ev.target.value ? Number(ev.target.value) : null })}
                      className="h-11 w-full rounded-control border border-border bg-surface px-3 text-sm text-text-main"
                    >
                      {offered.length === 0 && <option value="">{uk.access.noRoles}</option>}
                      {offered.map((r) => (
                        <option key={r.id} value={r.id}>{r.name}</option>
                      ))}
                    </select>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="min-h-[44px] min-w-[44px] justify-self-end text-text-muted"
                    aria-label={uk.access.removeEmployee(e.login.trim() || String(index + 1))}
                    onClick={() => setEmployees((list) => list.filter((x) => x.key !== e.key))}
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              ))}

              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" className="min-h-[44px]" onClick={addEmployee}>
                  <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  {uk.access.addEmployee}
                </Button>
                {!showExisting && (
                  <Button type="button" variant="ghost" className="min-h-[44px]" onClick={() => setShowExisting(true)}>
                    {uk.access.moveExisting}
                  </Button>
                )}
              </div>

              {showExisting && (
                <div className="space-y-2 border border-border p-3">
                  <p className="text-sm font-medium text-text-main">{uk.access.moveExisting}</p>
                  <p className="text-xs text-text-muted">{uk.access.moveExistingHint}</p>
                  {movable.length === 0 ? (
                    <p className="text-sm text-text-muted">{uk.access.noOtherEmployees}</p>
                  ) : (
                    <ul className="max-h-56 divide-y divide-border overflow-y-auto">
                      {movable.map((u) => (
                        <li key={u.id}>
                          <label className="flex min-h-[44px] cursor-pointer items-center gap-3 px-1 text-sm">
                            <input
                              type="checkbox"
                              className="h-5 w-5 accent-[var(--primary)]"
                              checked={moveIds.has(u.id)}
                              onChange={() => toggleMove(u.id)}
                            />
                            <span className="font-medium text-text-main">{u.login}</span>
                            <span className="truncate text-text-muted">{u.organisation?.name}</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </fieldset>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" className="min-h-[44px]" disabled={pending}>
              {pending ? uk.common.loading : uk.access.createOrganisationButton}
            </Button>
            <Button type="button" variant="ghost" className="min-h-[44px]" onClick={onCancel} disabled={pending}>
              {uk.common.cancel}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
