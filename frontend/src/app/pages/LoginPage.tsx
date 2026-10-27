import React, { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "@/platform/auth/AuthContext";
import { uk } from "@/modules/reports/i18n";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/ui/Card";
import { Input } from "@/ui/Input";
import { Button } from "@/ui/Button";
import { ThemeToggle } from "@/ui/ThemeToggle";
import { MakerMark } from "@/ui/MakerMark";
import { ApiError } from "@/platform/api/client";

export function LoginPage() {
  const { session, isLoading, login } = useAuth();
  const navigate = useNavigate();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-page text-text-muted">
        {uk.common.loading}
      </div>
    );
  }

  if (session) {
    return <Navigate to={session.role === "admin" ? "/admin" : "/report"} replace />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) return;

    setError(null);
    setIsSubmitting(true);

    try {
      const newSession = await login({ login: username.trim(), password });
      navigate(newSession.role === "admin" ? "/admin" : "/report", { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError(uk.auth.networkError);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col justify-between bg-page text-text-main p-4 sm:p-6 animate-fade-in">
      <header className="flex justify-between items-center max-w-md w-full mx-auto py-2">
        <div className="flex items-center space-x-2">
          <span className="font-semibold text-primary tracking-tight text-lg">Легкий звіт</span>
        </div>
        <div className="flex items-center space-x-2">
          <MakerMark />
          <ThemeToggle />
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center">
        <Card className="w-full max-w-md shadow-md border-border">
          <CardHeader className="text-center pb-2">
            <CardTitle className="text-xl sm:text-2xl">{uk.auth.loginTitle}</CardTitle>
            <CardDescription>{uk.auth.loginDescription}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4 pt-2">
              {error && (
                <div
                  role="alert"
                  className="p-3 rounded-control text-xs sm:text-sm bg-destructive/10 text-destructive border border-destructive/20 font-medium"
                >
                  {error}
                </div>
              )}

              <div className="space-y-1.5">
                <label
                  htmlFor="login-username"
                  className="block text-xs sm:text-sm font-medium text-text-main"
                >
                  {uk.auth.loginLabel}
                </label>
                <Input
                  id="login-username"
                  name="username"
                  type="text"
                  autoComplete="username"
                  required
                  autoFocus
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="admin або назва магазину"
                  disabled={isSubmitting}
                />
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="login-password"
                  className="block text-xs sm:text-sm font-medium text-text-main"
                >
                  {uk.auth.passwordLabel}
                </label>
                <Input
                  id="login-password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isSubmitting}
                />
              </div>

              <Button
                type="submit"
                className="w-full mt-2 font-medium"
                isLoading={isSubmitting}
                disabled={!username.trim() || !password || isSubmitting}
              >
                {isSubmitting ? uk.auth.submittingButton : uk.auth.submitButton}
              </Button>
            </form>
          </CardContent>
        </Card>
      </main>

      <footer className="text-center py-4 text-xs text-text-muted">
        <span>© {new Date().getFullYear()} {uk.appTitle} · {uk.appSubtitle}</span>
      </footer>
    </div>
  );
}
