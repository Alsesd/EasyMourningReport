/** Public access through Cloudflare Tunnel: status, start with explicit confirmation, stop, autostart. */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { systemApi } from "@/platform/system/api";
import { ukPlatform as uk } from "@/platform/i18n";
import type { SettingsSectionProps } from "@/platform/modules";
import { Card, CardHeader, CardTitle, CardContent } from "@/ui/Card";
import { Button } from "@/ui/Button";
import { Input } from "@/ui/Input";
import { Globe, AlertCircle, CheckCircle, ExternalLink } from "lucide-react";

export default function TunnelSection({ notify }: SettingsSectionProps) {
  const queryClient = useQueryClient();

  // ----------------------------------------------------
  // TUNNEL TAB STATE
  // ----------------------------------------------------
  const [tunnelAuthKey, setTunnelAuthKey] = useState("");
  const [confirmPublic, setConfirmPublic] = useState(false);

  const { data: tunnelData } = useQuery({
    queryKey: ["adminTunnel"],
    queryFn: () => systemApi.status(),
    refetchInterval: (query) => {
      const state = query.state.data?.state;
      if (state === "starting") return 1500;
      return 3000;
    },
  });

  const tunnel = tunnelData || {
    enabled: false,
    autostart: false,
    state: "disabled",
    public_url: "",
    login_url: "",
    error: "",
  };

  const isTunnelActive = ["starting", "running", "authentication-required", "stopping"].includes(
    tunnel.state
  );

  const startTunnelMutation = useMutation({
    mutationFn: () =>
      systemApi.start({ confirm_public: true, autostart: true, auth_key: tunnelAuthKey.trim() || null }),
    onSuccess: (res) => {
      setTunnelAuthKey("");
      queryClient.setQueryData(["adminTunnel"], res);
      notify("Запуск тунелю запитано.");
    },
    onError: (err: Error) => notify(err.message || "Не вдалося запустити тунель.", "err"),
  });

  const stopTunnelMutation = useMutation({
    mutationFn: () => systemApi.stop(),
    onSuccess: (res) => {
      queryClient.setQueryData(["adminTunnel"], res);
      notify("Тунель відключено.");
    },
    onError: (err: Error) => notify(err.message || "Не вдалося вимкнути тунель.", "err"),
  });

  const setTunnelAutostartMutation = useMutation({
    mutationFn: (enabled: boolean) =>
      systemApi.setAutostart(enabled),
    onSuccess: (res) => {
      queryClient.setQueryData(["adminTunnel"], res);
      notify(
        res.autostart ? "Автозапуск тунелю увімкнено." : "Автозапуск тунелю вимкнено."
      );
    },
    onError: (err: Error) => notify(err.message || "Не вдалося змінити автозапуск.", "err"),
  });

  return (
        <div className="space-y-6 max-w-2xl animate-fade-in">
          <Card>
            <CardHeader className="p-4 sm:p-5 border-b border-border">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center space-x-2">
                  <Globe className="h-5 w-5 text-primary" />
                  <span>{uk.system.tunnel.title}</span>
                </CardTitle>
                <div className="flex items-center space-x-2">
                  <span
                    className={`h-3 w-3 rounded-full transition-all duration-300 ${
                      tunnel.state === "running"
                        ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.7)]"
                        : tunnel.state === "starting"
                        ? "bg-amber-500 animate-pulse shadow-[0_0_8px_rgba(245,158,11,0.5)]"
                        : "bg-text-muted/40"
                    }`}
                  />
                  <span className="text-xs font-semibold text-text-main">
                    {tunnel.state === "running"
                      ? "Підключено · Активний"
                      : tunnel.state === "starting"
                      ? uk.system.tunnel.statusStarting
                      : tunnel.state === "stopped" || tunnel.state === "enabled-but-not-running"
                      ? uk.system.tunnel.statusStopped
                      : tunnel.state === "disabled"
                      ? uk.system.tunnel.statusDisabled
                      : tunnel.state}
                  </span>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-4 sm:p-6 space-y-5">
              <p className="text-sm text-text-muted">{uk.system.tunnel.subtitle}</p>

              {tunnel.error && (
                <div className="p-3 rounded-control bg-destructive/10 border border-destructive/20 text-destructive text-sm flex items-center space-x-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{tunnel.error}</span>
                </div>
              )}

              {/* Public link if active */}
              {tunnel.public_url && (
                <div className="p-4 rounded-card bg-primary/10 border border-primary/20 space-y-1">
                  <span className="text-xs font-semibold text-primary block">
                    {uk.system.tunnel.liveUrl}
                  </span>
                  <a
                    href={tunnel.public_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-base font-bold text-text-main hover:underline flex items-center break-all"
                  >
                    {tunnel.public_url}
                    <ExternalLink className="h-4 w-4 ml-1.5 shrink-0 inline text-primary" />
                  </a>
                </div>
              )}

              {/* Connected without explicit public URL */}
              {tunnel.state === "running" && !tunnel.public_url && (
                <div className="p-4 rounded-card bg-emerald-500/10 border border-emerald-500/20 space-y-1">
                  <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 block">
                    Тунель активний
                  </span>
                  <p className="text-sm text-text-main">
                    З'єднання з Cloudflare встановлено. Публічний доступ працює через налаштований домен тунелю.
                  </p>
                </div>
              )}

              {/* Controls */}
              {isTunnelActive ? (
                <div>
                  <Button
                    variant="destructive"
                    className="min-h-[44px] w-full sm:w-auto"
                    onClick={() => stopTunnelMutation.mutate()}
                    disabled={stopTunnelMutation.isPending}
                  >
                    {stopTunnelMutation.isPending ? "Вимкнення…" : uk.system.tunnel.stopTunnel}
                  </Button>
                </div>
              ) : (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!confirmPublic) return;
                    startTunnelMutation.mutate();
                  }}
                  className="space-y-4 pt-2"
                >
                  {tunnel.has_token && (
                    <div className="p-3 rounded-control bg-primary/10 border border-primary/20 text-text-main text-xs flex items-center space-x-2">
                      <CheckCircle className="h-4 w-4 text-primary shrink-0" />
                      <span>Токен Cloudflare збережено. Ви можете запустити тунель без повторного введення токена.</span>
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-text-muted">
                      {uk.system.tunnel.authKeyLabel}
                    </label>
                    <Input
                      type="password"
                      value={tunnelAuthKey}
                      onChange={(e) => setTunnelAuthKey(e.target.value)}
                      placeholder={
                        tunnel.has_token
                          ? "Збережений токен активний (заповніть лише для зміни)"
                          : "Порожньо — швидкий безкоштовний Quick Tunnel"
                      }
                      autoComplete="off"
                      className="h-11"
                    />
                  </div>

                  <label className="flex items-center space-x-2.5 cursor-pointer min-h-[44px] select-none">
                    <input
                      type="checkbox"
                      checked={confirmPublic}
                      onChange={(e) => setConfirmPublic(e.target.checked)}
                      className="h-4 w-4 rounded border-border text-primary"
                    />
                    <span className="text-sm font-medium text-text-main">
                      Підтверджую публічний доступ через тунель
                    </span>
                  </label>

                  <Button
                    type="submit"
                    variant="primary"
                    className="min-h-[44px] w-full sm:w-auto"
                    disabled={!confirmPublic || startTunnelMutation.isPending}
                  >
                    {startTunnelMutation.isPending ? "Підключення…" : uk.system.tunnel.startTunnel}
                  </Button>
                </form>
              )}

              {/* Autostart preference toggle */}
              <div className="pt-4 border-t border-border flex items-center justify-between">
                <label className="flex items-center space-x-2.5 cursor-pointer min-h-[44px] select-none">
                  <input
                    type="checkbox"
                    checked={Boolean(tunnel.autostart)}
                    onChange={(e) => setTunnelAutostartMutation.mutate(e.target.checked)}
                    disabled={setTunnelAutostartMutation.isPending}
                    className="h-4 w-4 rounded border-border text-primary"
                  />
                  <span className="text-sm text-text-main">
                    {uk.system.tunnel.autostartToggle}
                  </span>
                </label>
                <span className="text-xs text-text-muted">Оновлюється автоматично</span>
              </div>
            </CardContent>
          </Card>
        </div>
  );
}
