/** Administrators only: every signed-in device of every employee, with the power to end sessions. */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import { accessApi } from "@/platform/access/api";
import { formatDateTime, ukPlatform as uk } from "@/platform/i18n";
import type { AdminSessionDTO } from "@/platform/api/types";
import type { AdminSectionProps } from "@/platform/modules";
import { Button } from "@/ui/Button";
import { useConfirm } from "@/ui/ConfirmDialog";

const t = uk.sessions;

/** Sessions grouped by employee, in the order the server sent them (by login). */
export function groupByUser(rows: AdminSessionDTO[]): AdminSessionDTO[][] {
  const groups = new Map<number, AdminSessionDTO[]>();
  for (const r of rows) groups.set(r.user_id, [...(groups.get(r.user_id) ?? []), r]);
  return [...groups.values()];
}

export default function SessionsSection({ notify }: AdminSectionProps) {
  const queryClient = useQueryClient();
  const { ask, dialog } = useConfirm(uk.common.cancel);
  const { data, isLoading } = useQuery({ queryKey: ["adminSessions"], queryFn: accessApi.sessions, refetchInterval: 30000 });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["adminSessions"] });
  const onError = (err: Error) => notify(err.message, "err");
  const end = useMutation({ mutationFn: (id: number) => accessApi.endSession(id), onSuccess: () => { notify(t.ended); void refresh(); }, onError });
  const endAll = useMutation({ mutationFn: (uid: number) => accessApi.endUserSessions(uid), onSuccess: () => { notify(t.endedAll); void refresh(); }, onError });

  if (isLoading) return <p className="text-sm text-text-muted">{uk.common.loading}</p>;
  const groups = groupByUser(data ?? []);
  if (groups.length === 0) return <p className="text-sm text-text-muted">{t.empty}</p>;

  return (
    <div className="max-w-4xl space-y-6">
      <p className="text-sm text-text-muted">{t.note}</p>
      {groups.map((sessions) => {
        const u = sessions[0];
        const who = u.full_name || u.login;
        return (
          <section key={u.user_id} aria-label={who} className="border-t-2 border-ink">
            <div className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div className="min-w-0">
                <h3 className="font-serif text-lg font-semibold text-text-main">{who}</h3>
                <p className="text-sm text-text-muted">
                  {u.login} · {u.organisation?.name ?? uk.account.platformStaff} · {t.devicesCount(sessions.length)}
                  {!u.active && ` · ${t.disabledAccount}`}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => ask({ title: t.endAll, description: t.confirmEndAll(who), actionLabel: t.endAll, onConfirm: () => endAll.mutate(u.user_id) })}
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
                {t.endAll}
              </Button>
            </div>
            <ul className="divide-y divide-border border-t border-border">
              {sessions.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0 text-sm">
                    <p className="font-medium text-text-main">
                      {s.device}
                      {s.current && <span className="ml-2 text-primary">· {t.current}</span>}
                    </p>
                    <p className="text-text-muted">
                      {t.address}: <span className="figure">{s.ip}</span> · {t.started}: <span className="figure">{formatDateTime(s.created_at)}</span> · {t.lastSeen}:{" "}
                      <span className="figure">{formatDateTime(s.last_seen)}</span>
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`${t.endSession}: ${who}, ${s.device}`}
                    onClick={() => ask({ title: t.endSession, description: t.confirmEnd(who, s.device), actionLabel: t.endSession, onConfirm: () => end.mutate(s.id) })}
                  >
                    {t.endSession}
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {dialog}
    </div>
  );
}
