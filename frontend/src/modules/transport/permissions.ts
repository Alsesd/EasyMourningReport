/** Permission codes of the transport module (mirrors internal/transport/module.go). */
export const TP = {
  create: "transport.orders.create",
  viewAll: "transport.orders.view_all",
  manage: "transport.orders.manage",
} as const;

export const ANY_TRANSPORT = [TP.create, TP.viewAll, TP.manage];
