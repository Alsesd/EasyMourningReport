/** Organisations, users, roles, permissions, own password and audit log. */

import { api } from "@/platform/api/client";
import type {
  AuditLogDTO,
  MessageDTO,
  MutationDTO,
  OrganisationCreateDTO,
  OrganisationDTO,
  OrganisationUpdateDTO,
  PermissionDTO,
  RoleDTO,
  RoleInputDTO,
  UserCreateDTO,
  UserDTO,
  UserUpdateDTO,
} from "@/platform/api/types";

export const accessApi = {
  organisations: () => api.get<OrganisationDTO[]>("/api/v1/organisations"),
  createOrganisation: (payload: OrganisationCreateDTO) =>
    api.post<OrganisationDTO>("/api/v1/organisations", payload),
  updateOrganisation: (id: number, payload: OrganisationUpdateDTO) =>
    api.put<OrganisationDTO>(`/api/v1/organisations/${id}`, payload),
  deleteOrganisation: (id: number) => api.delete<MutationDTO>(`/api/v1/organisations/${id}`),
  restoreOrganisation: (id: number) => api.post<OrganisationDTO>(`/api/v1/organisations/${id}/restore`),

  users: (params: { organisation_id?: number; platform?: boolean } = {}) =>
    api.get<UserDTO[]>("/api/v1/users", { params }),
  createUser: (payload: UserCreateDTO) => api.post<UserDTO>("/api/v1/users", payload),
  updateUser: (id: number, payload: UserUpdateDTO) => api.put<UserDTO>(`/api/v1/users/${id}`, payload),
  setUserPassword: (id: number, password: string) =>
    api.put<MessageDTO>(`/api/v1/users/${id}/password`, { password }),
  deleteUser: (id: number) => api.delete<MutationDTO>(`/api/v1/users/${id}`),

  roles: (params: { organisation_id?: number } = {}) => api.get<RoleDTO[]>("/api/v1/roles", { params }),
  createRole: (payload: RoleInputDTO) => api.post<RoleDTO>("/api/v1/roles", payload),
  updateRole: (id: number, payload: RoleInputDTO) => api.put<RoleDTO>(`/api/v1/roles/${id}`, payload),
  deleteRole: (id: number) => api.delete<MutationDTO>(`/api/v1/roles/${id}`),
  permissions: () => api.get<PermissionDTO[]>("/api/v1/permissions"),

  changeOwnPassword: (password: string) => api.put<MessageDTO>("/api/v1/me/password", { password }),

  logActions: () => api.get<string[]>("/api/v1/admin/log-actions"),
  logs: (params: { limit: number; login?: string; action?: string }) =>
    api.get<AuditLogDTO[]>("/api/v1/admin/logs", { params }),
};

/** Permission codes owned by the platform (mirrors backend app/platform/accounts/permissions.py). */
export const P = {
  organisationsManage: "platform.organisations.manage",
  usersManage: "platform.users.manage",
  rolesManage: "platform.roles.manage",
  auditView: "platform.audit.view",
  systemManage: "platform.system.manage",
  orgUsersManage: "org.users.manage",
} as const;
