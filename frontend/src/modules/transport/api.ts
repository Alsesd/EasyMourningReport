/** Typed API surface for the public transport/tunnel connection. */

import { api } from "@/platform/api/client";

export interface TunnelStatus {
  enabled: boolean;
  autostart: boolean;
  has_token?: boolean;
  state: string;
  public_url: string;
  login_url: string;
  error: string;
}

export const transportApi = {
  status: () => api.get<TunnelStatus>("/api/v1/admin/tunnel"),
  start: (payload: { confirm_public: true; autostart: boolean; auth_key: string | null }) =>
    api.post<TunnelStatus>("/api/v1/admin/tunnel", payload),
  stop: () => api.delete<TunnelStatus>("/api/v1/admin/tunnel"),
  setAutostart: (enabled: boolean) =>
    api.put<TunnelStatus>("/api/v1/admin/tunnel/autostart", { enabled }),
};
