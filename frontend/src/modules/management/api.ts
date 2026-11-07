/** Management dashboard: blocks supplied by the modules the caller may see. */

import { api } from "@/platform/api/client";
import type { DashboardDTO } from "@/platform/api/types";

export const dashboardApi = {
  get: (period: string) => api.get<DashboardDTO>("/api/v1/dashboard", { params: { period } }),
};
