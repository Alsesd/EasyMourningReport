import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { uk } from "@/i18n/uk";

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRole?: "admin" | "store";
}

export function ProtectedRoute({ children, allowedRole }: ProtectedRouteProps) {
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
    return <Navigate to={session.role === "admin" ? "/admin" : "/report"} replace />;
  }

  return <>{children}</>;
}
