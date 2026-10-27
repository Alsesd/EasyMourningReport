import {
  FileText,
  Send,
  Truck,
  UserCheck,
  type LucideIcon,
} from "lucide-react";

export type PermissionCode =
  | "transport_order"
  | "sales_report"
  | "vehicle_dispatch"
  | "driver";

export interface PermissionMeta {
  code: PermissionCode;
  path: string;
  label: string;
  shortLabel: string;
  description: string;
  hint: string;
  icon: LucideIcon;
}

export const permissionCatalog: PermissionMeta[] = [
  {
    code: "transport_order",
    path: "transport-order",
    label: "Замовлення транспорту",
    shortLabel: "Транспорт",
    description: "Заявки на транспорт, маршрути та погодження перевезень.",
    hint: "Розділ замовлень транспорту буде доступний після підключення модуля логістики.",
    icon: Truck,
  },
  {
    code: "sales_report",
    path: "sales-report",
    label: "Звіт по продажу",
    shortLabel: "Звіт",
    description: "Щомісячний звіт по продажах для вашого відділу.",
    hint: "Відкрийте звіт, щоб внести кількість проданих позицій за поточний місяць.",
    icon: FileText,
  },
  {
    code: "vehicle_dispatch",
    path: "vehicle-dispatch",
    label: "Відправка машин",
    shortLabel: "Відправка",
    description: "Планування виїздів, готовність машин і підтвердження відправлень.",
    hint: "Розділ відправки машин буде доступний після підключення модуля логістики.",
    icon: Send,
  },
  {
    code: "driver",
    path: "driver",
    label: "Водій",
    shortLabel: "Водій",
    description: "Особисті завдання, рейси та статуси виконання для водіїв.",
    hint: "Розділ водія буде доступний після підключення модуля логістики.",
    icon: UserCheck,
  },
];

export const permissionByCode = new Map(
  permissionCatalog.map((permission) => [permission.code, permission])
);

export const permissionByPath = new Map(
  permissionCatalog.map((permission) => [permission.path, permission])
);

export function getPermission(code: string | undefined) {
  return code ? permissionByCode.get(code as PermissionCode) : undefined;
}

export function permissionLabel(code: string) {
  return getPermission(code)?.label ?? code;
}
