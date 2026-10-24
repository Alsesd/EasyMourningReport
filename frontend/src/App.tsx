import { Suspense, lazy } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@/context/ThemeContext";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { LoginPage } from "@/pages/LoginPage";
import { uk } from "@/i18n/uk";

// Route-level code splitting: store route must not load admin code
const StoreReportPage = lazy(() => import("@/pages/StoreReportPage"));
const AdminLayout = lazy(() => import("@/pages/AdminLayout"));
const AdminSummaryPage = lazy(() => import("@/pages/AdminSummaryPage"));
const AdminReportsPage = lazy(() => import("@/pages/AdminReportsPage"));
const AdminReportDetailPage = lazy(() => import("@/pages/AdminReportDetailPage"));
const AdminLogsPage = lazy(() => import("@/pages/AdminLogsPage"));
const AdminSettingsPage = lazy(() => import("@/pages/AdminSettingsPage"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

function RootRedirect() {
  const { session, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-page text-text-muted">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  return <Navigate to={session.role === "admin" ? "/admin/summary" : "/report"} replace />;
}

function PageFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-page text-text-muted">
      <div className="flex flex-col items-center space-y-2">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <span className="text-xs">{uk.common.loading}</span>
      </div>
    </div>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <BrowserRouter>
            <Suspense fallback={<PageFallback />}>
              <Routes>
                <Route path="/login" element={<LoginPage />} />

                <Route
                  path="/report"
                  element={
                    <ProtectedRoute allowedRole="store">
                      <StoreReportPage />
                    </ProtectedRoute>
                  }
                />

                <Route
                  path="/admin"
                  element={
                    <ProtectedRoute allowedRole="admin">
                      <AdminLayout />
                    </ProtectedRoute>
                  }
                >
                  <Route index element={<Navigate to="summary" replace />} />
                  <Route path="summary" element={<AdminSummaryPage />} />
                  <Route path="reports" element={<AdminReportsPage />} />
                  <Route path="reports/:reportId" element={<AdminReportDetailPage />} />
                  <Route path="logs" element={<AdminLogsPage />} />
                  <Route path="settings" element={<AdminSettingsPage />} />
                  <Route path="*" element={<Navigate to="summary" replace />} />
                </Route>

                <Route path="/" element={<RootRedirect />} />
                <Route path="*" element={<RootRedirect />} />
              </Routes>
            </Suspense>
          </BrowserRouter>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
