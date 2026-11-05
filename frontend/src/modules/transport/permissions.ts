/** Permission codes of the transport module (mirrors backend app/modules/transport/permissions.py). */
export const TP = {
  create: "transport.orders.create",
  viewAll: "transport.orders.view_all",
  manage: "transport.orders.manage",
} as const;

export const ANY_TRANSPORT = [TP.create, TP.viewAll, TP.manage];
