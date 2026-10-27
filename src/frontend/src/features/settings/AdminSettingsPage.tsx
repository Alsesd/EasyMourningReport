import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AnimatedCollapse } from "@/shared/components/ui/AnimatedCollapse";
import { uk } from "@/shared/i18n/uk";
import {
  AlertCircle,
  Building2,
  CheckCircle,
  Database,
  Globe,
  Package,
  Shield,
  Users,
} from "lucide-react";
import BackupSettings from "./BackupSettings";
import DepartmentsSettings from "./DepartmentsSettings";
import ProductsSettings from "./ProductsSettings";
import SecuritySettings from "./SecuritySettings";
import TunnelSettings from "./TunnelSettings";
import UsersSettings from "./UsersSettings";
import { useTunnelStatus } from "./useTunnelStatus";
import type { Notify } from "./types";

const tabs = [
  { id: "products", label: uk.settings.tabs.products, icon: Package },
  { id: "users", label: uk.settings.tabs.users, icon: Users },
  { id: "departments", label: uk.settings.tabs.departments, icon: Building2 },
  { id: "security", label: uk.settings.tabs.security, icon: Shield },
  { id: "tunnel", label: uk.settings.tabs.tunnel, icon: Globe },
  { id: "backup", label: uk.settings.tabs.backup, icon: Database },
];

export default function AdminSettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const currentTab = searchParams.get("tab") || "products";
  const { tunnel } = useTunnelStatus(currentTab === "tunnel");

  const [feedback, setFeedback] = useState<{ text: string; kind: "ok" | "err" } | null>(null);

  const notify: Notify = (text, kind = "ok") => {
    setFeedback({ text, kind });
  };

  const setTab = (tab: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("tab", tab);
    setSearchParams(next);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-text-main">{uk.settings.title}</h1>
        <p className="text-sm text-text-muted mt-1">
          Керування товарами, користувачами, відділами, доступом та безпекою
        </p>
      </div>

      <div className="flex border-b border-border overflow-x-auto space-x-1">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = currentTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setTab(tab.id)}
              className={`flex items-center px-4 py-3 text-sm font-medium border-b-2 whitespace-nowrap transition-colors min-h-[44px] ${
                isActive
                  ? "border-primary text-primary font-semibold"
                  : "border-transparent text-text-muted hover:text-text-main hover:border-border"
              }`}
            >
              <Icon className="h-4 w-4 mr-2 shrink-0" />
              {tab.label}
              {tab.id === "tunnel" && (
                <span
                  className={`ml-2 h-2 w-2 rounded-full shrink-0 transition-colors ${
                    tunnel.state === "running"
                      ? "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.7)]"
                      : tunnel.state === "starting"
                      ? "bg-amber-500 animate-pulse"
                      : "bg-text-muted/30"
                  }`}
                  title={
                    tunnel.state === "running"
                      ? "Підключено"
                      : tunnel.state === "starting"
                      ? uk.settings.tunnel.statusStarting
                      : uk.settings.tunnel.statusStopped
                  }
                />
              )}
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
              aria-label="Закрити"
            >
              ×
            </button>
          </div>
        )}
      </AnimatedCollapse>

      {currentTab === "products" && <ProductsSettings notify={notify} />}
      {currentTab === "users" && <UsersSettings notify={notify} />}
      {currentTab === "departments" && <DepartmentsSettings notify={notify} />}
      {currentTab === "security" && <SecuritySettings notify={notify} />}
      {currentTab === "tunnel" && <TunnelSettings notify={notify} />}
      {currentTab === "backup" && <BackupSettings />}
    </div>
  );
}
