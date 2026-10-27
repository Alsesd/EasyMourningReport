import { useQuery } from "@tanstack/react-query";
import { api } from "@/shared/api/client";
import type { TunnelStatus } from "./types";

const DISABLED_TUNNEL: TunnelStatus = {
  enabled: false,
  autostart: false,
  state: "disabled",
  public_url: "",
  login_url: "",
  error: "",
};

export function useTunnelStatus(pollWhileOpen: boolean) {
  const { data } = useQuery({
    queryKey: ["adminTunnel"],
    queryFn: () => api.get<TunnelStatus>("/api/v1/admin/tunnel"),
    refetchInterval: (query) => {
      const state = query.state.data?.state;
      if (state === "starting") return 1500;
      if (pollWhileOpen) return 3000;
      return false;
    },
  });

  const tunnel = data || DISABLED_TUNNEL;
  const isTunnelActive = ["starting", "running", "authentication-required", "stopping"].includes(
    tunnel.state
  );

  return { tunnel, isTunnelActive };
}
