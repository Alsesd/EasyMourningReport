import { Suspense, lazy } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@/app/providers/ThemeContext";
import { AuthProvider, useAuth } from "@/platform/auth/AuthContext";
import { ProtectedRoute } from "@/platform/auth/ProtectedRoute";
import { LoginPage } from "@/app/pages/LoginPage";
import { uk } from "@/modules/reports/i18n";
import { reportPages } from "@/modules/reports/module";

// Route-level code splitting: the reports module owns its lazy page registry.
const {
  StoreReportPage,
  AdminSummaryPage,
  AdminReportsPage,
  AdminReportDetailPage,
  AdminLogsPage,
  AdminSettingsPage,
} = reportPages;
const AdminLayout = lazy(() => import("@/app/layouts/AdminLayout"));

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
