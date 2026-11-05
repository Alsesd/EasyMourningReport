import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/platform/auth/AuthContext";
import { ukPlatform as uk } from "@/platform/i18n";
import { allowed } from "@/platform/modules";
import { useLandingPath } from "@/app/routing/landing";

interface ProtectedRouteProps {
  children: React.ReactNode;
  /** The user needs at least one of these permission codes; empty or omitted means any signed-in user. */
  permissions?: string[];
}

export function PageSpinner() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-page text-text-muted">
      <div className="flex flex-col items-center space-y-2">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <span className="text-xs">{uk.common.loading}</span>
      </div>
    </div>
  );
}

export function ProtectedRoute({ children, permissions = [] }: ProtectedRouteProps) {
  const { session, isLoading } = useAuth();
  const location = useLocation();
  const landing = useLandingPath();

  if (isLoading) {
    return <PageSpinner />;
  }

  if (!session) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (!allowed(session.permissions, permissions)) {
    return <Navigate to={landing} replace />;
  }

  return <>{children}</>;
}
