/** The signed-in user's own notifications (the bell). */

import { api } from "@/platform/api/client";
import type { NotificationsDTO } from "@/platform/api/types";

export const notificationsApi = {
  list: () => api.get<NotificationsDTO>("/api/v1/notifications", { params: { limit: 30 } }),
  read: (id: number) => api.post<NotificationsDTO>(`/api/v1/notifications/${id}/read`, {}),
  readAll: () => api.post<NotificationsDTO>("/api/v1/notifications/read-all", {}),
};
