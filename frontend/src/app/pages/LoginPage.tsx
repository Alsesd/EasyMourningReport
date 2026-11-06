import React, { useEffect, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/platform/auth/AuthContext";
import { ukPlatform as uk } from "@/platform/i18n";
import { landingPathFor } from "@/app/routing/landing";
import { Input } from "@/ui/Input";
import { Button } from "@/ui/Button";
import { ThemeToggle } from "@/ui/ThemeToggle";
import { MakerMark } from "@/ui/MakerMark";
import { ApiError } from "@/platform/api/client";
import { AlertCircle, Eye, EyeOff } from "lucide-react";
import { returnPath } from "./returnPath";

/** The page a signed-out user was sent away from (set by ProtectedRoute), if it is worth returning to. */
export function LoginPage() {
  const { session, isLoading, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  // Deep links survive sign-in; the route guard sends the user on if they may not open the page.
  const target = (s: Parameters<typeof landingPathFor>[0]) => returnPath(location.state) ?? landingPathFor(s);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    document.title = `${uk.auth.loginTitle} — ${uk.appTitle}`;
  }, []);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-page text-text-muted" role="status" aria-live="polite">
        <div className="mr-3 h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        {uk.common.loading}
      </div>
    );
  }

  if (session) {
    return <Navigate to={target(session)} replace />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError(uk.auth.credentialsRequired);
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      const newSession = await login({ login: username.trim(), password });
      navigate(target(newSession), { replace: true });
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
    <div className="min-h-screen lg:grid lg:grid-cols-[minmax(380px,1fr)_minmax(460px,1fr)]">
      {/* The title page of the record book: the one large, quiet gesture on this screen. */}
      <aside className="flex flex-col border-b border-border bg-surface-raised px-6 py-6 sm:px-10 lg:min-h-screen lg:border-b-0 lg:border-r lg:px-[clamp(40px,6vw,96px)] lg:py-12">
        <div className="flex items-center justify-between gap-3">
          <span aria-hidden="true" className="grid h-10 w-10 place-items-center rounded-control bg-primary font-serif text-base font-semibold text-primary-fg">
            ЛЗ
          </span>
          <div className="flex items-center gap-1 lg:hidden">
            <MakerMark />
            <ThemeToggle />
          </div>
        </div>
        <div className="mt-8 max-w-[520px] lg:my-auto">
          <h1 className="font-serif text-[40px] font-semibold leading-none text-text-main sm:text-[52px] lg:text-[clamp(52px,5vw,72px)]">
            {uk.appTitle}
          </h1>
          <div className="ledger mt-5 max-w-[420px] pt-3">
            <p className="text-[15px] text-text-muted">{uk.appSubtitle}</p>
            <p className="mt-3 hidden text-[15px] leading-7 text-text-muted sm:block">{uk.auth.portalDescription}</p>
          </div>
        </div>
        <p className="mt-auto hidden pt-8 text-xs text-text-muted lg:block">
          © {new Date().getFullYear()} {uk.appTitle}
        </p>
      </aside>

      <section className="flex flex-col px-6 py-8 sm:px-10 lg:min-h-screen lg:px-[clamp(40px,7vw,112px)] lg:py-12">
        <div className="hidden items-center justify-end gap-2 lg:flex">
          <MakerMark />
          <ThemeToggle />
        </div>

        <main className="flex flex-1 items-center">
          <div className="w-full max-w-[400px]">
            <h2 className="text-[28px] leading-tight text-text-main">{uk.auth.loginTitle}</h2>
            <p className="mt-1.5 text-[15px] text-text-muted">{uk.auth.loginDescription}</p>

            <form onSubmit={handleSubmit} className="mt-8 space-y-5" noValidate>
              {error && (
                <div role="alert" className="flex items-start gap-2.5 border-l-2 border-destructive bg-destructive/10 px-3.5 py-3 text-sm text-destructive">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{error}</span>
                </div>
              )}

              <div className="space-y-1.5">
                <label htmlFor="login-username" className="block text-sm font-medium text-text-main">
                  {uk.auth.loginLabel}
                </label>
                <Input
                  id="login-username"
                  name="username"
                  type="text"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder={uk.auth.loginPlaceholder}
                  disabled={isSubmitting}
                  aria-invalid={Boolean(error) || undefined}
                  className="min-h-[48px]"
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="login-password" className="block text-sm font-medium text-text-main">
                  {uk.auth.passwordLabel}
                </label>
                <div className="relative">
                  <Input
                    id="login-password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={isSubmitting}
                    aria-invalid={Boolean(error) || undefined}
                    className="min-h-[48px] pr-12"
                  />
                  <button
                    type="button"
                    className="absolute right-0.5 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-control text-text-muted transition-colors hover:text-text-main disabled:pointer-events-none disabled:opacity-50"
                    onClick={() => setShowPassword((visible) => !visible)}
                    aria-label={showPassword ? uk.auth.hidePassword : uk.auth.showPassword}
                    aria-pressed={showPassword}
                    title={showPassword ? uk.auth.hidePassword : uk.auth.showPassword}
                    disabled={isSubmitting}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                  </button>
                </div>
              </div>

              <Button type="submit" size="lg" className="w-full" isLoading={isSubmitting} disabled={isSubmitting}>
                {isSubmitting ? uk.auth.submittingButton : uk.auth.submitButton}
              </Button>
            </form>

            <p className="mt-6 border-t border-border pt-4 text-sm leading-6 text-text-muted">{uk.auth.dataPrivacyNote}</p>
          </div>
        </main>
      </section>
    </div>
  );
}
