/** Report, catalogue, review and per-organisation settings API owned by this module. */

import { api } from "@/platform/api/client";
import type {
  AdminReportDetailDTO,
  AdminReportListItemDTO,
  ImportResultDTO,
  MutationDTO,
  ProductDTO,
  ProductCreateDTO,
  ProductUpdateDTO,
  ReportSettingsDTO,
  StoreReportDTO,
  SummaryDTO,
  ReportSaveDTO,
} from "@/platform/api/types";

export const reportsApi = {
  summary: (params: { period: string; submitted_only: boolean }) =>
    api.get<SummaryDTO>("/api/v1/admin/summary", { params }),

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

  reportSettings: () => api.get<ReportSettingsDTO[]>("/api/v1/reports/settings"),
  setCalculationEnabled: (organisationId: number, enabled: boolean) =>
    api.put<ReportSettingsDTO>(`/api/v1/reports/settings/${organisationId}`, { calculation_enabled: enabled }),

  summaryExcelUrl: (period: string, submittedOnly: boolean) =>
    `/api/v1/admin/summary.xlsx?period=${encodeURIComponent(period)}${submittedOnly ? "&submitted_only=true" : ""}`,
};
