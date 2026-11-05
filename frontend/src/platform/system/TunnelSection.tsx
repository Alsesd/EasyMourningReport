/** Public access through Cloudflare Tunnel: status, start with explicit confirmation, stop, autostart. */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { systemApi } from "@/platform/system/api";
import { ukPlatform as uk } from "@/platform/i18n";
import type { AdminSectionProps } from "@/platform/modules";
import type { TunnelStatusDTO } from "@/platform/api/types";
import { Card, CardContent } from "@/ui/Card";
import { Button } from "@/ui/Button";
import { Input } from "@/ui/Input";
import { StateDot } from "@/ui/StateDot";
import { AlertCircle, CheckCircle, ExternalLink } from "lucide-react";

const ACTIVE = new Set(["starting", "running"]);
const t = uk.system.tunnel;

export function tunnelTone(state: string): "ok" | "busy" | "error" | "idle" {
  if (state === "running") return "ok";
  if (state === "starting") return "busy";
  if (state === "error") return "error";
  return "idle";
}

export default function TunnelSection({ notify }: AdminSectionProps) {
  const queryClient = useQueryClient();
  const [token, setToken] = useState("");
  const [confirmPublic, setConfirmPublic] = useState(false);

  const { data: tunnel } = useQuery({
    queryKey: ["adminTunnel"],
    queryFn: () => systemApi.tunnel(),
    refetchInterval: (query) => (query.state.data?.state === "starting" ? 1500 : 5000),
  });
  const update = (next: TunnelStatusDTO) => queryClient.setQueryData(["adminTunnel"], next);
  const onError = (err: Error) => notify(err.message, "err");

  const start = useMutation({
    mutationFn: () => systemApi.startTunnel({ confirm_public: true, autostart: true, token: token.trim() || null }),
    onSuccess: (next) => {
      setToken("");
      setConfirmPublic(false);
      update(next);
      notify("Запуск тунелю запитано.");
    },
    onError,
  });
  const stop = useMutation({
    mutationFn: () => systemApi.stopTunnel(),
    onSuccess: (next) => {
      update(next);
      notify("Тунель відключено.");
    },
    onError,
  });
  const autostart = useMutation({
    mutationFn: (enabled: boolean) => systemApi.setTunnelAutostart(enabled),
    onSuccess: (next) => {
      update(next);
      notify(next.autostart ? "Автозапуск тунелю увімкнено." : "Автозапуск тунелю вимкнено.");
    },
    onError,
  });

  if (!tunnel) {
    return <p className="text-sm text-text-muted">{uk.common.loading}</p>;
  }
  const active = ACTIVE.has(tunnel.state);

  return (
    <Card className="max-w-2xl animate-fade-in">
      <CardContent className="p-4 sm:p-6 space-y-5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-text-muted">{t.subtitle}</p>
          <span className="flex items-center gap-2 text-xs font-semibold text-text-main shrink-0">
            <StateDot tone={tunnelTone(tunnel.state)} />
            {uk.system.states[tunnel.state] ?? tunnel.state}
          </span>
        </div>

        {tunnel.error && (
          <div role="alert" className="p-3 rounded-control bg-destructive/10 border border-destructive/20 text-destructive text-sm flex items-start gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span className="break-words">{tunnel.error}</span>
          </div>
        )}

        {tunnel.public_url && (
          <div className="p-4 rounded-card bg-primary/10 border border-primary/20 space-y-1">
            <span className="text-xs font-semibold text-primary block">{t.liveUrl}</span>
            <a
              href={tunnel.public_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-base font-bold text-text-main hover:underline inline-flex items-center break-all"
            >
              {tunnel.public_url}
              <ExternalLink className="h-4 w-4 ml-1.5 shrink-0 text-primary" aria-hidden="true" />
            </a>
          </div>
        )}

        {active ? (
          <Button variant="destructive" className="min-h-[44px] w-full sm:w-auto" onClick={() => stop.mutate()} disabled={stop.isPending}>
            {stop.isPending ? "Вимкнення…" : t.stopTunnel}
          </Button>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (confirmPublic) start.mutate();
            }}
            className="space-y-4"
          >
            {tunnel.has_token && (
              <p className="p-3 rounded-control bg-primary/10 border border-primary/20 text-text-main text-xs flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-primary shrink-0" />
                Токен Cloudflare збережено. Заповніть поле лише щоб замінити його.
              </p>
            )}
            <div className="space-y-1.5">
              <label htmlFor="tunnel-token" className="text-xs font-medium text-text-muted">{t.tokenLabel}</label>
              <Input
                id="tunnel-token"
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                autoComplete="off"
                className="h-11"
              />
            </div>
            <label className="flex items-center gap-2.5 cursor-pointer min-h-[44px] select-none">
              <input
                type="checkbox"
                checked={confirmPublic}
                onChange={(e) => setConfirmPublic(e.target.checked)}
                className="h-4 w-4 rounded border-border text-primary"
              />
              <span className="text-sm font-medium text-text-main">Підтверджую публічний доступ через тунель</span>
            </label>
            <Button type="submit" className="min-h-[44px] w-full sm:w-auto" disabled={!confirmPublic || start.isPending}>
              {start.isPending ? "Підключення…" : t.startTunnel}
            </Button>
          </form>
        )}

        <label className="pt-4 border-t border-border flex items-center gap-2.5 cursor-pointer min-h-[44px] select-none">
          <input
            type="checkbox"
            checked={tunnel.autostart}
            onChange={(e) => autostart.mutate(e.target.checked)}
            disabled={autostart.isPending}
            className="h-4 w-4 rounded border-border text-primary"
          />
          <span className="text-sm text-text-main">{t.autostartToggle}</span>
        </label>
      </CardContent>
    </Card>
  );
}
