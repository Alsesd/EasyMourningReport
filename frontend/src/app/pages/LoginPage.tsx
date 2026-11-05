import React, { useEffect, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/platform/auth/AuthContext";
import { ukPlatform as uk } from "@/platform/i18n";
import { landingPathFor } from "@/app/routing/landing";
import { Card, CardContent } from "@/ui/Card";
import { Input } from "@/ui/Input";
import { Button } from "@/ui/Button";
import { ThemeToggle } from "@/ui/ThemeToggle";
import { MakerMark } from "@/ui/MakerMark";
import { ApiError } from "@/platform/api/client";
import { BookOpen, ShieldCheck, ArrowUpRight, AlertCircle, Eye, EyeOff } from "lucide-react";

/** The page a signed-out user was sent away from (set by ProtectedRoute), if it is worth returning to. */
function returnPath(state: unknown): string | null {
  const from = (state as { from?: { pathname?: string; search?: string } } | null)?.from;
  if (!from?.pathname || from.pathname === "/" || from.pathname.startsWith("/login")) return null;
  return from.pathname + (from.search ?? "");
}

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
    <div className="login-layout min-h-screen lg:grid lg:grid-cols-[minmax(360px,0.92fr)_minmax(480px,1.08fr)]">
      <aside className="login-story flex flex-col justify-between px-7 py-7 sm:px-10 sm:py-9 lg:min-h-screen lg:px-[clamp(42px,6vw,94px)] lg:py-12">
        <div className="relative z-10 flex items-center gap-3">
          <div className="portal-brand-mark h-11 w-11" aria-hidden="true">
            <BookOpen className="h-5 w-5" strokeWidth={1.7} />
          </div>
          <div>
            <p className="text-base font-semibold tracking-tight text-[#fffefa]">{uk.appTitle}</p>
            <p className="mt-0.5 text-[11px] tracking-wide text-[#c5d4c7]">{uk.appSubtitle}</p>
          </div>
        </div>

        <div className="relative z-10 mt-6 max-w-[540px] sm:mt-9 lg:my-auto lg:py-16">
          <div className="mb-5 flex items-center gap-3">
            <span className="login-story-rule" />
            <span className="text-[10px] font-semibold uppercase tracking-[0.19em] text-[#ddc99e]">{uk.auth.portalEyebrow}</span>
          </div>
          <h1 className="max-w-[520px] text-[27px] font-semibold leading-[1.22] tracking-[-0.035em] text-[#f7f6ef] sm:text-[34px] lg:text-[clamp(34px,3.2vw,48px)]">
            {uk.auth.portalHeadline}
          </h1>
          <p className="mt-4 hidden max-w-[420px] text-sm leading-6 text-[#c6d3c7] sm:block sm:text-base sm:leading-7">
            {uk.auth.portalDescription}
          </p>

        </div>
      </aside>

      <section className="flex flex-col px-5 py-5 sm:px-8 sm:py-7 lg:min-h-screen lg:px-[clamp(36px,7vw,112px)] lg:py-9">
        <div className="flex items-center justify-end gap-2">
          <MakerMark />
          <ThemeToggle />
        </div>

        <main className="flex flex-1 items-center justify-center py-8 sm:py-10 lg:py-4">
          <div className="w-full max-w-[440px]">
            <div className="mb-6 sm:mb-8">
              <h2 className="text-[26px] font-semibold tracking-[-0.035em] text-text-main sm:text-3xl">{uk.auth.loginTitle}</h2>
              <p className="mt-2 text-sm leading-6 text-text-muted">{uk.auth.loginDescription}</p>
            </div>

            <Card className="login-card overflow-hidden">
              <CardContent className="p-5 sm:p-6">
                <form onSubmit={handleSubmit} className="space-y-5" noValidate>
                  {error && (
                    <div
                      role="alert"
                      aria-live="polite"
                      className="flex items-start gap-2.5 rounded-control border border-destructive/25 bg-destructive/10 p-3.5 text-sm font-medium text-destructive"
                    >
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                      <span>{error}</span>
                    </div>
                  )}

                  <div className="space-y-2">
                    <label htmlFor="login-username" className="block text-xs font-semibold tracking-wide text-text-main">
                      {uk.auth.loginLabel}
                    </label>
                    <Input
                      id="login-username"
                      name="username"
                      type="text"
                      autoComplete="username"
                      required
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder={uk.auth.loginPlaceholder}
                      disabled={isSubmitting}
                      className="min-h-[48px] bg-surface px-3.5 text-sm"
                    />
                  </div>

                  <div className="space-y-2">
                    <label htmlFor="login-password" className="block text-xs font-semibold tracking-wide text-text-main">
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
                        className="min-h-[48px] bg-surface px-3.5 pr-12 text-sm"
                      />
                      <button
                        type="button"
                        className="absolute right-2 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-lg text-text-muted transition-colors hover:bg-page hover:text-text-main focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:pointer-events-none disabled:opacity-50"
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

                  <Button
                    type="submit"
                    className="group mt-1 min-h-[49px] w-full justify-center gap-2 font-semibold tracking-wide"
                    isLoading={isSubmitting}
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? uk.auth.submittingButton : uk.auth.submitButton}
                    {!isSubmitting && <ArrowUpRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" aria-hidden="true" />}
                  </Button>
                </form>
              </CardContent>
            </Card>

            <div className="login-security-note mt-4 flex items-center gap-3 px-4 py-3.5">
              <ShieldCheck className="h-[18px] w-[18px] shrink-0 text-primary" strokeWidth={1.8} />
              <p className="text-xs leading-5">{uk.auth.dataPrivacyNote}</p>
            </div>
          </div>
        </main>

        <footer className="flex flex-col items-center justify-between gap-2 border-t border-border/80 pt-4 text-center text-[10px] tracking-wide text-text-muted sm:flex-row sm:text-left">
          <span>© {new Date().getFullYear()} {uk.appTitle}</span>
          <span>{uk.appSubtitle}</span>
        </footer>
      </section>
    </div>
  );
}
