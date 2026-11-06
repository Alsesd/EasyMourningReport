import { BiometricOffer } from "@/platform/account/BiometricOffer";
import { DeviceSetup } from "@/platform/device/DeviceSetup";
import { Suspense, lazy } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@/platform/theme/ThemeContext";
import { AuthProvider, useAuth } from "@/platform/auth/AuthContext";
import { ModuleRegistryContext } from "@/platform/modules";
import { PageSpinner, ProtectedRoute } from "@/app/routing/ProtectedRoute";
import { useLandingPath } from "@/app/routing/landing";
import { LoginPage } from "@/app/pages/LoginPage";
import { appModules } from "@/app/registry";

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
  const landing = useLandingPath();
  if (isLoading) return <PageSpinner />;
  if (!session) return <Navigate to="/login" replace />;
  return <Navigate to={landing} replace />;
}

const routes = appModules.flatMap((m) => m.routes);
const standaloneRoutes = routes.filter((r) => r.layout === "standalone");
const shellRoutes = routes.filter((r) => r.layout !== "standalone");

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <ModuleRegistryContext.Provider value={appModules}>
            <BrowserRouter>
              <BiometricOffer />
              <DeviceSetup />
              <Suspense fallback={<PageSpinner />}>
                <Routes>
                  <Route path="/login" element={<LoginPage />} />

                  {standaloneRoutes.map(({ path, component: Page, permissions }) => (
                    <Route
                      key={path}
                      path={path}
                      element={
                        <ProtectedRoute permissions={permissions}>
                          <Page />
                        </ProtectedRoute>
                      }
                    />
                  ))}

                  <Route
                    path="/admin"
                    element={
                      <ProtectedRoute>
                        <AdminLayout />
                      </ProtectedRoute>
                    }
                  >
                    <Route index element={<RootRedirect />} />
                    {shellRoutes.map(({ path, component: Page, permissions }) => (
                      <Route
                        key={path}
                        path={path}
                        element={
                          <ProtectedRoute permissions={permissions}>
                            <Page />
                          </ProtectedRoute>
                        }
                      />
                    ))}
                    <Route path="*" element={<RootRedirect />} />
                  </Route>

                  <Route path="/" element={<RootRedirect />} />
                  <Route path="*" element={<RootRedirect />} />
                </Routes>
              </Suspense>
            </BrowserRouter>
          </ModuleRegistryContext.Provider>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
