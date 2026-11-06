/** Transport-order API owned by this module. */

import { api } from "@/platform/api/client";
import type { TransportOrderDTO, TransportOrderInputDTO, TransportStatusDTO } from "@/platform/api/types";

export interface OrderQuery {
  date?: string;
  from?: string;
  to?: string;
  status?: string;
  organisation_id?: number;
}

export const transportApi = {
  status: () => api.get<TransportStatusDTO>("/api/v1/transport/status"),
  orders: (params: OrderQuery) => api.get<TransportOrderDTO[]>("/api/v1/transport/orders", { params: { ...params } }),
  order: (id: number) => api.get<TransportOrderDTO>(`/api/v1/transport/orders/${id}`),
  create: (input: TransportOrderInputDTO) => api.post<TransportOrderDTO>("/api/v1/transport/orders", input),
  update: (id: number, input: TransportOrderInputDTO) => api.put<TransportOrderDTO>(`/api/v1/transport/orders/${id}`, input),
  cancel: (id: number) => api.post<TransportOrderDTO>(`/api/v1/transport/orders/${id}/cancel`, {}),
  setStatus: (id: number, status: string, note: string) =>
    api.post<TransportOrderDTO>(`/api/v1/transport/orders/${id}/status`, { status, note }),
};
