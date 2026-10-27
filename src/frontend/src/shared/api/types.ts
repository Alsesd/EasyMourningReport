import type { components, paths } from "./schema";

export type Schemas = components["schemas"];

export type SessionDTO = Schemas["SessionDTO"];
export type StoreReportDTO = Schemas["StoreReportDTO"];
export type ReportLineDTO = Schemas["ReportLineDTO"];
export type ReportInputDTO = Schemas["ReportInputDTO"];
export type ReportSaveDTO = Schemas["ReportSaveDTO"];
export type ReportQuantityDTO = Schemas["ReportQuantityDTO"];
export type InactiveReportLineDTO = Schemas["InactiveReportLineDTO"];
export type ProductDTO = Schemas["ProductDTO"];
export type ProductCreateDTO = Schemas["ProductCreateDTO"];
export type ProductUpdateDTO = Schemas["ProductUpdateDTO"];
export type PricePointDTO = Schemas["PricePointDTO"];
export type StoreDTO = Schemas["StoreDTO"];
export type StoreCreateDTO = Schemas["StoreCreateDTO"];
export type StoreUpdateDTO = Schemas["StoreUpdateDTO"];
export type SummaryDTO = Schemas["SummaryDTO"];
export type SummaryRowDTO = Schemas["SummaryRowDTO"];
export type SummaryStoreDTO = Schemas["SummaryStoreDTO"];
export type AdminReportListItemDTO = Schemas["AdminReportListItemDTO"];
export type AdminReportDetailDTO = Schemas["AdminReportDetailDTO"];
export type AuditLogDTO = Schemas["AuditLogDTO"];
export type MutationDTO = Schemas["MutationDTO"];
export type ImportResultDTO = Schemas["ImportResultDTO"];
export type MessageDTO = Schemas["MessageDTO"];
export type LoginDTO = Schemas["LoginDTO"];
export type ReportStatusDTO = Schemas["ReportStatusDTO"];
export type PasswordDTO = Schemas["PasswordDTO"];
export type StorePasswordDTO = Schemas["StorePasswordDTO"];
export type UserDTO = Schemas["UserDTO"];
export type UserCreateDTO = Schemas["UserCreateDTO"];
export type UserUpdateDTO = Schemas["UserUpdateDTO"];
export type DepartmentUserDTO = Schemas["DepartmentUserDTO"];

export type { paths };
