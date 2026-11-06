/** Server administration: public tunnel, backups, health and the hub overview. */

import { api } from "@/platform/api/client";
import type {
  AdminOverviewDTO,
  BackupDTO,
  SystemHealthDTO,
  TunnelStartDTO,
  TunnelStatusDTO,
  UpdateStatusDTO,
} from "@/platform/api/types";

export const systemApi = {
  tunnel: () => api.get<TunnelStatusDTO>("/api/v1/admin/tunnel"),
  startTunnel: (payload: TunnelStartDTO) => api.post<TunnelStatusDTO>("/api/v1/admin/tunnel", payload),
  stopTunnel: () => api.delete<TunnelStatusDTO>("/api/v1/admin/tunnel"),
  setTunnelAutostart: (enabled: boolean) =>
    api.put<TunnelStatusDTO>("/api/v1/admin/tunnel/autostart", { enabled }),
  backups: (limit = 10) => api.get<BackupDTO[]>("/api/v1/admin/backups", { params: { limit } }),
  health: () => api.get<SystemHealthDTO>("/api/v1/admin/system/health"),
  overview: () => api.get<AdminOverviewDTO>("/api/v1/admin/overview"),
  update: () => api.get<UpdateStatusDTO>("/api/v1/admin/update"),
  checkUpdate: () => api.post<UpdateStatusDTO>("/api/v1/admin/update/check", {}),
  applyUpdate: () => api.post<UpdateStatusDTO>("/api/v1/admin/update/apply", {}),
  backupDownloadUrl: "/api/v1/admin/backup/download",
  backupFileUrl: (name: string) => `/api/v1/admin/backups/${encodeURIComponent(name)}/download`,
};
