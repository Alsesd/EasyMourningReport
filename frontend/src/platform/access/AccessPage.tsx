/** Users, organisations and roles. Tabs appear according to the caller's permissions. */

import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/platform/auth/AuthContext";
import { P } from "@/platform/access/api";
import { ukPlatform as uk } from "@/platform/i18n";
import { AnimatedCollapse } from "@/ui/AnimatedCollapse";
import { AlertCircle, Building2, CheckCircle, KeySquare, Users } from "lucide-react";
import UsersTab from "./UsersTab";
import OrganisationsTab from "./OrganisationsTab";
import RolesTab from "./RolesTab";

export type Notify = (text: string, kind?: "ok" | "err") => void;

export default function AccessPage() {
  const { can } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [feedback, setFeedback] = useState<{ text: string; kind: "ok" | "err" } | null>(null);
  const notify: Notify = (text, kind = "ok") => setFeedback({ text, kind });

  const tabs = [
    { id: "users", label: uk.access.tabs.users, icon: Users, show: can(P.usersManage, P.orgUsersManage) },
    { id: "organisations", label: uk.access.tabs.organisations, icon: Building2, show: can(P.organisationsManage) },
    { id: "roles", label: uk.access.tabs.roles, icon: KeySquare, show: can(P.rolesManage) },
  ].filter((t) => t.show);
  const current = tabs.find((t) => t.id === searchParams.get("tab")) ?? tabs[0];

  const setTab = (tab: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("tab", tab);
    setSearchParams(next);
    setFeedback(null);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-text-main">{uk.access.title}</h1>
        <p className="text-sm text-text-muted mt-1">{uk.access.subtitle}</p>
      </div>

      {tabs.length > 1 && (
        <div role="tablist" className="flex border-b border-border overflow-x-auto space-x-1">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = current?.id === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(tab.id)}
                className={`flex items-center px-4 py-3 text-sm font-medium border-b-2 whitespace-nowrap transition-colors min-h-[44px] ${
                  active
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
      )}

      <AnimatedCollapse open={Boolean(feedback)}>
        {feedback && (
          <div
            role="status"
            aria-live="polite"
            className={`p-4 rounded-card border flex items-center justify-between text-sm ${
              feedback.kind === "ok"
                ? "bg-emerald-500/10 border-emerald-500/25 text-emerald-700 dark:text-emerald-300"
                : "bg-destructive/10 border-destructive/25 text-destructive"
            }`}
          >
            <div className="flex items-center space-x-2">
              {feedback.kind === "ok" ? <CheckCircle className="h-5 w-5 shrink-0" /> : <AlertCircle className="h-5 w-5 shrink-0" />}
              <span className="whitespace-pre-line">{feedback.text}</span>
            </div>
            <button
              type="button"
              className="text-text-muted hover:text-text-main p-1 rounded min-h-[44px] min-w-[44px]"
              onClick={() => setFeedback(null)}
              aria-label={uk.common.close}
            >
              ×
            </button>
          </div>
        )}
      </AnimatedCollapse>

      {current?.id === "users" && <UsersTab notify={notify} />}
      {current?.id === "organisations" && <OrganisationsTab notify={notify} />}
      {current?.id === "roles" && <RolesTab notify={notify} />}
    </div>
  );
}
