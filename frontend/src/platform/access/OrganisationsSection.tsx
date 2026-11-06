/** Organisations (stores and future partners): create, rename, archive or delete, restore. */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/platform/auth/AuthContext";
import { accessApi, P } from "@/platform/access/api";
import type { OrganisationDTO } from "@/platform/api/types";
import { useModuleRegistry } from "@/platform/modules";
import { ukPlatform as uk } from "@/platform/i18n";
import { Button } from "@/ui/Button";
import { Input } from "@/ui/Input";
import { AnimatedCollapse } from "@/ui/AnimatedCollapse";
import { useConfirm } from "@/ui/ConfirmDialog";
import { Archive, Plus, RotateCcw, Trash2, X } from "lucide-react";
import type { AdminSectionProps } from "@/platform/modules";
import { NewOrganisationForm, type CreateOutcome } from "./NewOrganisationForm";

/** "Користувачів: 2, звітів: 5": record counts per module, named by the module's title. */
function usageText(org: OrganisationDTO, titles: Record<string, string>): string {
  const parts = [uk.access.usersCount(org.user_count ?? 0)];
  for (const [module, count] of Object.entries(org.usage ?? {})) parts.push(`${titles[module] ?? module}: ${count}`);
  return parts.join(", ");
}

function useModuleTitles(): Record<string, string> {
  return Object.fromEntries(useModuleRegistry().map((m) => [m.id, m.title]));
}

function OrganisationRow({ org, notify, onArchive }: { org: OrganisationDTO; notify: AdminSectionProps["notify"]; onArchive: () => void }) {
  const queryClient = useQueryClient();
  const titles = useModuleTitles();
  const [name, setName] = useState(org.name);
  const rename = useMutation({
    mutationFn: () => accessApi.updateOrganisation(org.id, { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["access"] });
      notify(uk.access.saved);
    },
    onError: (err: Error) => notify(err.message, "err"),
  });
  const changed = name.trim() !== org.name;

  return (
    <div className="flex flex-col gap-3 px-1 py-3 sm:flex-row sm:items-center" data-organisation-id={org.id}>
      <div className="flex-1 min-w-0 space-y-1">
        <Input
          aria-label={uk.access.organisationName}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
          className="h-11 font-medium"
        />
        <p className="text-xs text-text-muted">{usageText(org, titles)}</p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {changed && (
          <Button size="sm" className="min-h-[44px]" disabled={rename.isPending} onClick={() => rename.mutate()}>
            {uk.common.save}
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="text-destructive hover:bg-destructive/10 min-h-[44px] min-w-[44px]"
          aria-label={`${uk.access.archive} ${org.name}`}
          title={uk.access.archive}
          onClick={onArchive}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

export default function OrganisationsSection({ notify }: AdminSectionProps) {
  const { can } = useAuth();
  const titles = useModuleTitles();
  const queryClient = useQueryClient();
  const { ask, dialog } = useConfirm(uk.common.cancel);
  const [creating, setCreating] = useState(false);

  const { data: organisations = [], isLoading } = useQuery({
    queryKey: ["access", "organisations"],
    queryFn: () => accessApi.organisations(),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["access"] });
  const onError = (err: Error) => notify(err.message, "err");

  const created = (outcome: CreateOutcome) => {
    refresh();
    setCreating(false);
    const { organisation, created: made, moved, failures } = outcome;
    if (failures.length) notify(uk.access.organisationCreatedWithErrors(organisation.name, failures), "err");
    else notify(uk.access.organisationCreated(organisation.name, made, moved));
  };
  const remove = useMutation({
    mutationFn: (id: number) => accessApi.deleteOrganisation(id),
    onSuccess: (res) => {
      refresh();
      notify(res.message);
    },
    onError,
  });
  const restore = useMutation({
    mutationFn: (id: number) => accessApi.restoreOrganisation(id),
    onSuccess: () => {
      refresh();
      notify(uk.access.saved);
    },
    onError,
  });

  const active = organisations.filter((o) => !o.archived);
  const archived = organisations.filter((o) => o.archived);
  const canCreateUsers = can(P.usersManage);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button className="min-h-[44px]" onClick={() => setCreating(!creating)}>
          {creating ? <X className="mr-1.5 h-4 w-4" aria-hidden="true" /> : <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />}
          {creating ? uk.common.cancel : uk.access.addOrganisation}
        </Button>
      </div>

      <AnimatedCollapse open={creating}>
        {creating && <NewOrganisationForm canManageUsers={canCreateUsers} onDone={created} onCancel={() => setCreating(false)} />}
      </AnimatedCollapse>

      <div className="ledger">
        <div className="divide-y divide-border">
          {isLoading ? (
            <p className="p-6 text-sm text-text-muted">{uk.common.loading}</p>
          ) : (
            active.map((org) => (
              <OrganisationRow
                key={`${org.id}-${org.name}`}
                org={org}
                notify={notify}
                onArchive={() =>
                  ask({
                    title: uk.access.archive,
                    description: uk.access.confirmArchive(org.name),
                    actionLabel: uk.access.archive,
                    onConfirm: () => remove.mutate(org.id),
                  })
                }
              />
            ))
          )}
        </div>
      </div>

      {archived.length > 0 && (
        <details className="group border-t border-border">
          <summary className="flex min-h-[48px] cursor-pointer list-none items-center gap-2 px-1 text-sm font-medium text-text-muted [&::-webkit-details-marker]:hidden">
            <Archive className="h-4 w-4" aria-hidden="true" />
            {uk.access.archivedSection} ({archived.length})
          </summary>
          <div className="divide-y divide-border border-l-2 border-border pl-3">
            {archived.map((org) => (
              <div key={org.id} className="flex items-center justify-between gap-4 py-3">
                <div>
                  <span className="text-sm text-text-muted">{org.name}</span>
                  <p className="text-xs text-text-muted">{usageText(org, titles)}</p>
                </div>
                <Button size="sm" variant="outline" onClick={() => restore.mutate(org.id)}>
                  <RotateCcw className="h-4 w-4" aria-hidden="true" />
                  {uk.access.restore}
                </Button>
              </div>
            ))}
          </div>
        </details>
      )}
      {dialog}
    </div>
  );
}
