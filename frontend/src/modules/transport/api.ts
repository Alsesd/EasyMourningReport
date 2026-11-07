/** Transport-order API owned by this module. */

import { api } from "@/platform/api/client";
import type { TransportDayDTO, TransportOrderDTO, TransportOrderInputDTO, TransportStatusDTO } from "@/platform/api/types";
import type { Assignment, Board, Car, CarInput, CatalogItem, ProductRequest, ProductRequestInput, Run, RunInput } from "./types";

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
  /** Dispatcher: change car, time and stops of an open order. */
  assign: (id: number, input: Assignment) => api.patch<TransportOrderDTO>(`/api/v1/transport/orders/${id}/assignment`, input),
  /** Dispatcher: replace the goods loaded on an order (so send the merged list). */
  setCargo: (id: number, lines: { item_id: number; quantity: number }[]) =>
    api.put<TransportOrderDTO>(`/api/v1/transport/orders/${id}/cargo`, { lines }),

  cars: (all = false) => api.get<{ items: Car[] }>("/api/v1/transport/cars", { params: all ? { all: 1 } : {} }),
  addCar: (input: CarInput) => api.post<Car>("/api/v1/transport/cars", input),
  updateCar: (id: number, patch: { label?: string; active?: boolean }) => api.patch<Car>(`/api/v1/transport/cars/${id}`, patch),
  /** Orderable products. The server sends an ETag; the browser revalidates, so callers keep it for a long time. */
  catalog: () => api.get<{ items: CatalogItem[] }>("/api/v1/transport/catalog"),

  /** The contract does not say whether the list is bare or wrapped in `items`: both are accepted. */
  requests: (params: { date?: string; open?: boolean }) =>
    api
      .get<{ items: ProductRequest[] } | ProductRequest[]>("/api/v1/transport/product-requests", { params: { date: params.date, open: params.open ? 1 : undefined } })
      .then((r) => (Array.isArray(r) ? r : r.items)),
  createRequest: (input: ProductRequestInput) => api.post<ProductRequest>("/api/v1/transport/product-requests", input),
  updateRequest: (id: number, input: ProductRequestInput) => api.patch<ProductRequest>(`/api/v1/transport/product-requests/${id}`, input),
  cancelRequest: (id: number) => api.post<ProductRequest>(`/api/v1/transport/product-requests/${id}/cancel`, {}),
  rejectRequest: (id: number, note: string) => api.post<ProductRequest>(`/api/v1/transport/product-requests/${id}/reject`, { note }),

  runs: (date: string) => api.get<{ items: Run[] }>("/api/v1/transport/runs", { params: { date } }),
  createRun: (input: RunInput) => api.post<Run>("/api/v1/transport/runs", input),
  updateRun: (id: number, input: RunInput) => api.patch<Run>(`/api/v1/transport/runs/${id}`, input),
  setRunStatus: (id: number, status: string, note = "") => api.post<Run>(`/api/v1/transport/runs/${id}/status`, { status, note }),
  board: (date: string) => api.get<Board>("/api/v1/transport/board", { params: { date } }),
};
