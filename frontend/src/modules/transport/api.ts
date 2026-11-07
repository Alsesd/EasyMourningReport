/** Transport-order API owned by this module. */

import { api } from "@/platform/api/client";
import type { TransportDayDTO, TransportOrderDTO, TransportOrderInputDTO, TransportStatusDTO } from "@/platform/api/types";

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
  /** Order counts per day of a range (only days with orders), for the date strip. */
  days: (params: { from: string; to: string; organisation_id?: number }) =>
    api.get<TransportDayDTO[]>("/api/v1/transport/days", { params: { ...params } }),
  order: (id: number) => api.get<TransportOrderDTO>(`/api/v1/transport/orders/${id}`),
  create: (input: TransportOrderInputDTO) => api.post<TransportOrderDTO>("/api/v1/transport/orders", input),
  update: (id: number, input: TransportOrderInputDTO) => api.put<TransportOrderDTO>(`/api/v1/transport/orders/${id}`, input),
  cancel: (id: number) => api.post<TransportOrderDTO>(`/api/v1/transport/orders/${id}/cancel`, {}),
  setBearers: (id: number, names: string[]) => api.put<TransportOrderDTO>(`/api/v1/transport/orders/${id}/bearers`, { names }),
  setStatus: (id: number, status: string, note: string) =>
    api.post<TransportOrderDTO>(`/api/v1/transport/orders/${id}/status`, { status, note }),
};
