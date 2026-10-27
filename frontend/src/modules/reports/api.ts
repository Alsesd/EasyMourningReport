/** Report, catalogue, store, and administration API owned by this module. */

import { api } from "@/platform/api/client";
import type {
  AdminReportDetailDTO,
  AdminReportListItemDTO,
  AuditLogDTO,
  ImportResultDTO,
  MessageDTO,
  MutationDTO,
  ProductDTO,
  ProductCreateDTO,
  ProductUpdateDTO,
  StoreDTO,
  StoreCreateDTO,
  StoreUpdateDTO,
  StoreReportDTO,
  SummaryDTO,
  ReportSaveDTO,
} from "@/platform/api/types";

export const reportsApi = {
  summary: (params: { period: string; submitted_only: boolean }) =>
    api.get<SummaryDTO>("/api/v1/admin/summary", { params }),

  logActions: () => api.get<string[]>("/api/v1/admin/log-actions"),
  logs: (params: { limit: number; login?: string; action?: string }) =>
    api.get<AuditLogDTO[]>("/api/v1/admin/logs", { params }),

  reportList: (period: string) =>
    api.get<AdminReportListItemDTO[]>("/api/v1/admin/reports", { params: { period } }),
  reportDetail: (reportId: string) =>
    api.get<AdminReportDetailDTO>(`/api/v1/admin/reports/${encodeURIComponent(reportId)}`),
  setReportStatus: (reportId: string, status: "draft" | "submitted") =>
    api.patch<unknown>(`/api/v1/admin/reports/${encodeURIComponent(reportId)}`, { status }),

  storeReport: (period: string) =>
    api.get<StoreReportDTO>(`/api/v1/store/reports/${encodeURIComponent(period)}`),
  saveStoreReport: (period: string, payload: ReportSaveDTO) =>
    api.put<StoreReportDTO>(`/api/v1/store/reports/${encodeURIComponent(period)}`, payload),

  products: () => api.get<ProductDTO[]>("/api/v1/admin/products"),
  createProduct: (payload: ProductCreateDTO) => api.post<ProductDTO>("/api/v1/admin/products", payload),
  updateProduct: (id: number, payload: ProductUpdateDTO) =>
    api.put<ProductDTO>(`/api/v1/admin/products/${id}`, payload),
  updateProductPrice: (id: number, price: string) =>
    api.put<ProductDTO>(`/api/v1/admin/products/${id}/price`, { price }),
  deleteProduct: (id: number) => api.delete<MutationDTO>(`/api/v1/admin/products/${id}`),
  restoreProduct: (id: number) => api.post<MutationDTO>(`/api/v1/admin/products/${id}/restore`),
  importProducts: (formData: FormData) =>
    api.upload<ImportResultDTO>("/api/v1/admin/products/import", formData),

  stores: () => api.get<StoreDTO[]>("/api/v1/admin/stores"),
  createStore: (payload: StoreCreateDTO) => api.post<StoreDTO>("/api/v1/admin/stores", payload),
  updateStore: (id: number, payload: StoreUpdateDTO) =>
    api.put<StoreDTO>(`/api/v1/admin/stores/${id}`, payload),
  setStorePassword: (id: number, password: string) =>
    api.put<MessageDTO>(`/api/v1/admin/stores/${id}/password`, { password }),
  deleteStore: (id: number) => api.delete<MutationDTO>(`/api/v1/admin/stores/${id}`),
  restoreStore: (id: number) => api.post<MutationDTO>(`/api/v1/admin/stores/${id}/restore`),
  changeAdminPassword: (password: string) =>
    api.put<MessageDTO>("/api/v1/admin/password", { password }),
};
