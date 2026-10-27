import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/features/auth/AuthContext";
import { uk } from "@/shared/i18n/uk";

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRole?: "admin" | "store";
  requiredPermission?: string;
}

export function ProtectedRoute({
  children,
  allowedRole,
  requiredPermission,
}: ProtectedRouteProps) {
  const { session, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-page text-text-muted">
        <div className="flex flex-col items-center space-y-2">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <span className="text-xs">{uk.common.loading}</span>
        </div>
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (allowedRole && session.role !== allowedRole) {
    return <Navigate to={session.role === "admin" ? "/admin/summary" : "/workspace"} replace />;
  }

  if (requiredPermission && !(session.permissions ?? []).includes(requiredPermission)) {
    return <Navigate to={session.role === "admin" ? "/admin/summary" : "/workspace"} replace />;
  }

  return <>{children}</>;
}
