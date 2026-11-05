/** Transport-order API owned by this module. */

import { api } from "@/platform/api/client";
import type { TransportStatusDTO } from "@/platform/api/types";

export const transportApi = {
  status: () => api.get<TransportStatusDTO>("/api/v1/transport/status"),
};
