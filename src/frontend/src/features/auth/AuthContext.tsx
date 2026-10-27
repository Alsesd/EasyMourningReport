import React, { createContext, useContext } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/shared/api/client";
import type { SessionDTO, LoginDTO, MessageDTO } from "@/shared/api/types";

interface AuthContextType {
  session: SessionDTO | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (credentials: LoginDTO) => Promise<SessionDTO>;
  logout: () => Promise<void>;
  refetchSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();

  const {
    data: session,
    isLoading,
    refetch,
  } = useQuery<SessionDTO | null>({
    queryKey: ["session"],
    queryFn: async () => {
      try {
        return await api.get<SessionDTO>("/api/v1/session");
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          return null;
        }
        throw err;
      }
    },
    retry: (failureCount, error) => {
      if (error instanceof ApiError && error.status === 401) {
        return false;
      }
      return failureCount < 2;
    },
    staleTime: 5 * 60 * 1000,
  });

  const loginMutation = useMutation({
    mutationFn: async (credentials: LoginDTO) => {
      return await api.post<SessionDTO>("/api/v1/auth/login", credentials);
    },
    onSuccess: (newSession) => {
      queryClient.setQueryData(["session"], newSession);
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      try {
        await api.post<MessageDTO>("/api/v1/auth/logout");
      } catch {
        // Fallback: even if network error, clear local state
      }
    },
    onSuccess: () => {
      queryClient.setQueryData(["session"], null);
      queryClient.clear();
    },
  });

  const login = async (credentials: LoginDTO) => {
    return await loginMutation.mutateAsync(credentials);
  };

  const logout = async () => {
    await logoutMutation.mutateAsync();
  };

  const refetchSession = async () => {
    await refetch();
  };

  return (
    <AuthContext.Provider
      value={{
        session: session ?? null,
        isLoading,
        isAuthenticated: Boolean(session),
        login,
        logout,
        refetchSession,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
