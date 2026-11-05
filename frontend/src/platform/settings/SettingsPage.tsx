/** Settings host: one tab per section that installed modules contribute and the user may open. */

import { Suspense, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/platform/auth/AuthContext";
import { ukPlatform as uk } from "@/platform/i18n";
import { settingsSectionsFor, useModuleRegistry } from "@/platform/modules";
import { AnimatedCollapse } from "@/ui/AnimatedCollapse";
import { AlertCircle, CheckCircle } from "lucide-react";

export default function SettingsPage() {
  const { session } = useAuth();
  const sections = settingsSectionsFor(useModuleRegistry(), session?.permissions);
  const [searchParams, setSearchParams] = useSearchParams();
  const [feedback, setFeedback] = useState<{ text: string; kind: "ok" | "err" } | null>(null);

  const requested = searchParams.get("tab");
  const current = sections.find((s) => s.id === requested) ?? sections[0];

  const setTab = (tab: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("tab", tab);
    setSearchParams(next);
    setFeedback(null);
  };
  const notify = (text: string, kind: "ok" | "err" = "ok") => setFeedback({ text, kind });

  const Section = current?.component;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-text-main">{uk.settingsHost.title}</h1>
        <p className="text-sm text-text-muted mt-1">{uk.settingsHost.subtitle}</p>
      </div>

      <div role="tablist" className="flex border-b border-border overflow-x-auto space-x-1">
        {sections.map((tab) => {
          const Icon = tab.icon;
          const isActive = current?.id === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setTab(tab.id)}
              className={`flex items-center px-4 py-3 text-sm font-medium border-b-2 whitespace-nowrap transition-colors min-h-[44px] ${
                isActive
                  ? "border-primary text-primary font-semibold"
                  : "border-transparent text-text-muted hover:text-text-main hover:border-border"
              }`}
            >
              <Icon className="h-4 w-4 mr-2 shrink-0" />
              {tab.label}
            </button>
          );
        })}
      </div>

      <AnimatedCollapse open={Boolean(feedback)}>
        {feedback && (
          <div
            role="status"
            aria-live="polite"
            className={`p-4 rounded-card border flex items-center justify-between text-sm shadow-sm transition-all ${
              feedback.kind === "ok"
                ? "bg-emerald-500/10 border-emerald-500/25 text-emerald-700 dark:text-emerald-300"
                : "bg-destructive/10 border-destructive/25 text-destructive"
            }`}
          >
            <div className="flex items-center space-x-2">
              {feedback.kind === "ok" ? (
                <CheckCircle className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <AlertCircle className="h-5 w-5 shrink-0 text-destructive" />
              )}
              <span>{feedback.text}</span>
            </div>
            <button
              type="button"
              className="text-text-muted hover:text-text-main p-1 rounded min-h-[44px] min-w-[44px] flex items-center justify-center transition-colors"
              onClick={() => setFeedback(null)}
              aria-label={uk.common.close}
            >
              ×
            </button>
          </div>
        )}
      </AnimatedCollapse>

      {Section ? (
        <Suspense fallback={<p className="text-sm text-text-muted">{uk.common.loading}</p>}>
          <Section notify={notify} />
        </Suspense>
      ) : (
        <p className="text-sm text-text-muted">{uk.settingsHost.empty}</p>
      )}
    </div>
  );
}
