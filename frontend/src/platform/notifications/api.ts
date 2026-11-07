/** The signed-in user's own notifications (the bell). */

import { api } from "@/platform/api/client";
import type { NotificationsDTO, TestNotificationDTO } from "@/platform/api/types";

export const notificationsApi = {
  list: () => api.get<NotificationsDTO>("/api/v1/notifications", { params: { limit: 30 } }),
  read: (id: number) => api.post<NotificationsDTO>(`/api/v1/notifications/${id}/read`, {}),
  /** Sends the caller a test notification, to check that this device receives messages with the app closed. */
  test: () => api.post<TestNotificationDTO>("/api/v1/notifications/test", {}),
  readAll: () => api.post<NotificationsDTO>("/api/v1/notifications/read-all", {}),
};
