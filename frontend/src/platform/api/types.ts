import type { components, paths } from "./schema";

export type Schemas = components["schemas"];

// Platform
export type SessionDTO = Schemas["SessionDTO"];
export type LoginDTO = Schemas["LoginDTO"];
export type MessageDTO = Schemas["MessageDTO"];
export type AdminSessionDTO = Schemas["AdminSessionDTO"];
export type PasskeyDTO = Schemas["PasskeyDTO"];
export type MutationDTO = Schemas["MutationDTO"];
export type PasswordDTO = Schemas["PasswordDTO"];
export type AuditLogDTO = Schemas["AuditLogDTO"];
export type OrganisationRefDTO = Schemas["OrganisationRefDTO"];
export type OrganisationDTO = Schemas["OrganisationDTO"];
export type OrganisationCreateDTO = Schemas["OrganisationCreateDTO"];
export type OrganisationUpdateDTO = Schemas["OrganisationUpdateDTO"];
export type UserDTO = Schemas["UserDTO"];
export type UserCreateDTO = Schemas["UserCreateDTO"];
export type UserUpdateDTO = Schemas["UserUpdateDTO"];
export type RoleDTO = Schemas["RoleDTO"];
export type RoleInputDTO = Schemas["RoleInputDTO"];
export type PermissionDTO = Schemas["PermissionDTO"];
export type UpdateStatusDTO = Schemas["UpdateStatusDTO"];
export type TunnelStatusDTO = Schemas["TunnelStatusDTO"];
export type TunnelStartDTO = Schemas["TunnelStartDTO"];
export type BackupDTO = Schemas["BackupDTO"];
export type PushKeyDTO = Schemas["PushKeyDTO"];
export type NotificationDTO = Schemas["NotificationDTO"];
export type NotificationsDTO = Schemas["NotificationsDTO"];
export type SystemHealthDTO = Schemas["SystemHealthDTO"];
export type SystemMetricsDTO = Schemas["SystemMetricsDTO"];
export type DashboardDTO = Schemas["DashboardDTO"];
export type DashboardBlockDTO = Schemas["DashboardBlockDTO"];
export type SystemLogsDTO = Schemas["SystemLogsDTO"];
export type TestNotificationDTO = Schemas["TestNotificationDTO"];
export type IntegrityDTO = Schemas["IntegrityDTO"];
export type AdminOverviewDTO = Schemas["AdminOverviewDTO"];

// Reports module
export type StoreReportDTO = Schemas["StoreReportDTO"];
export type SignatureDTO = Schemas["SignatureDTO"];
export type ReportLineDTO = Schemas["ReportLineDTO"];
export type ReportInputDTO = Schemas["ReportInputDTO"];
export type ReportSaveDTO = Schemas["ReportSaveDTO"];
export type ReportQuantityDTO = Schemas["ReportQuantityDTO"];
export type InactiveReportLineDTO = Schemas["InactiveReportLineDTO"];
export type ProductDTO = Schemas["ProductDTO"];
export type ProductCreateDTO = Schemas["ProductCreateDTO"];
export type ProductUpdateDTO = Schemas["ProductUpdateDTO"];
export type PricePointDTO = Schemas["PricePointDTO"];
export type SummaryDTO = Schemas["SummaryDTO"];
export type SummaryRowDTO = Schemas["SummaryRowDTO"];
export type SummaryStoreDTO = Schemas["SummaryStoreDTO"];
export type AdminReportListItemDTO = Schemas["AdminReportListItemDTO"];
export type AdminReportDetailDTO = Schemas["AdminReportDetailDTO"];
export type ImportResultDTO = Schemas["ImportResultDTO"];
export type ReportStatusDTO = Schemas["ReportStatusDTO"];
export type ReportSettingsDTO = Schemas["ReportSettingsDTO"];

// Transport module
export type TransportStatusDTO = Schemas["TransportStatusDTO"];

export type { paths };

// Transport module
export type TransportOrderDTO = Schemas["TransportOrderDTO"];
export type TransportDayDTO = Schemas["TransportDayDTO"];
export type TransportOrderInputDTO = Schemas["TransportOrderInputDTO"];
export type TransportDeliveryDTO = Schemas["TransportDeliveryDTO"];
export type TransportCarriersDTO = Schemas["TransportCarriersDTO"];
