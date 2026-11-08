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
  MonthDaysDTO,
  DayReportDTO,
  DailyReportListItemDTO,
  MissedStoreDTO,
} from "@/platform/api/types";

/** A day of a month in URLs: YYYY-MM-DD, or "undated" for quantities entered for the whole month. */
export const UNDATED = "undated";

export const reportsApi = {
  summary: (params: { period: string; submitted_only: boolean; day?: string }) =>
    api.get<SummaryDTO>("/api/v1/admin/summary", {
      params: params.day ? { day: params.day, submitted_only: params.submitted_only } : { period: params.period, submitted_only: params.submitted_only },
    }),
  missedDays: (period: string) => api.get<MissedStoreDTO[]>("/api/v1/admin/missed-days", { params: { period } }),
  dailyReports: (day: string) => api.get<DailyReportListItemDTO[]>("/api/v1/admin/daily-reports", { params: { day } }),
  reportDays: (reportId: string) => api.get<MonthDaysDTO>(`/api/v1/admin/reports/${encodeURIComponent(reportId)}/days`),
  reportDay: (reportId: string, day: string) =>
    api.get<DayReportDTO>(`/api/v1/admin/reports/${encodeURIComponent(reportId)}/days/${encodeURIComponent(day)}`),
  setReportDayStatus: (reportId: string, day: string, status: "draft" | "submitted") =>
    api.patch<DayReportDTO>(`/api/v1/admin/reports/${encodeURIComponent(reportId)}/days/${encodeURIComponent(day)}`, { status }),

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
  storeDays: (period: string) => api.get<MonthDaysDTO>(`/api/v1/store/reports/${encodeURIComponent(period)}/days`),
  storeDay: (period: string, day: string) =>
    api.get<DayReportDTO>(`/api/v1/store/reports/${encodeURIComponent(period)}/days/${encodeURIComponent(day)}`),
  saveStoreDay: (period: string, day: string, payload: ReportSaveDTO) =>
    api.put<DayReportDTO>(`/api/v1/store/reports/${encodeURIComponent(period)}/days/${encodeURIComponent(day)}`, payload),

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

  summaryExcelUrl: (period: string, submittedOnly: boolean, day?: string) =>
    `/api/v1/admin/summary.xlsx?${day ? `day=${encodeURIComponent(day)}` : `period=${encodeURIComponent(period)}`}${submittedOnly ? "&submitted_only=true" : ""}`,
};
