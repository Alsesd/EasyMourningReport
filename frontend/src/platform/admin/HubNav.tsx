/** Navigation between the sections of «Адміністрування»: nested in the side rail on desktop, one picker on phones. */

import { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown, LayoutDashboard } from "lucide-react";
import { ukPlatform as uk } from "@/platform/i18n";
import type { AdminSection } from "@/platform/modules";
import { cn } from "@/ui/utils";
import { groupSections, HUB_PATH, sectionPath } from "./sections";

/** The sections as an indented, grouped list under the «Адміністрування» item of the side rail. */
export function HubRailNav({ sections }: { sections: AdminSection[] }) {
  const grouped = groupSections(sections);
  const link = (to: string, label: string, Icon: AdminSection["icon"], end?: boolean) => (
    <NavLink
      key={to}
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          "flex min-h-[40px] items-center gap-2.5 rounded-control pl-3 pr-2 text-sm transition-colors",
          isActive
            ? "bg-surface font-semibold text-text-main shadow-[inset_3px_0_0_var(--primary)]"
            : "text-text-muted hover:bg-surface/70 hover:text-text-main",
        )
      }
    >
      <Icon className="h-4 w-4 shrink-0" strokeWidth={1.8} aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </NavLink>
  );

  return (
    <nav aria-label={uk.hub.menuLabel} className="ml-[22px] mt-1 space-y-3 border-l border-border pb-2 pl-2">
      {link(HUB_PATH, uk.hub.overview, LayoutDashboard, true)}
      {grouped.map(([group, items]) => (
        <div key={group} className="space-y-0.5">
          <p className="px-3 pb-0.5 pt-1 text-xs font-medium uppercase tracking-wide text-text-muted">{uk.hub.groups[group]}</p>
          {items.map((s) => link(sectionPath(s.id), s.label, s.icon))}
        </div>
      ))}
    </nav>
  );
}

/** Phones: a single button naming the current section; it opens the grouped list. Sticks under the top bar. */
export function HubSectionPicker({ sections, current }: { sections: AdminSection[]; current?: AdminSection }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const grouped = groupSections(sections);
  const CurrentIcon = current?.icon ?? LayoutDashboard;
  const item =
    "flex min-h-[48px] cursor-pointer items-center gap-3 rounded-control px-3 text-[15px] text-text-main outline-none data-[highlighted]:bg-surface-raised";

  return (
    <div className="sticky top-[60px] z-20 -mx-4 border-b border-border bg-page/95 px-4 py-2 sm:-mx-8 sm:px-8 lg:hidden">
      <DropdownMenu.Root open={open} onOpenChange={setOpen}>
        <DropdownMenu.Trigger
          aria-label={`${uk.hub.menuLabel}: ${current?.label ?? uk.hub.overview}`}
          className="flex min-h-[48px] w-full items-center gap-3 rounded-control border border-border bg-surface px-3 text-left text-[15px] font-medium text-text-main"
        >
          <CurrentIcon className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">{current?.label ?? uk.hub.overview}</span>
          <ChevronDown className={cn("h-4 w-4 shrink-0 text-text-muted transition-transform", open && "rotate-180")} aria-hidden="true" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="start"
            sideOffset={6}
            className="z-50 max-h-[70vh] w-[var(--radix-dropdown-menu-trigger-width)] overflow-y-auto rounded-control border border-border bg-surface p-1.5 shadow-lg"
          >
            <DropdownMenu.Item className={item} onSelect={() => navigate(HUB_PATH)}>
              <LayoutDashboard className="h-4 w-4 text-text-muted" aria-hidden="true" />
              <span className="flex-1">{uk.hub.overview}</span>
              {!current && <Check className="h-4 w-4 text-primary" aria-hidden="true" />}
            </DropdownMenu.Item>
            {grouped.map(([group, items]) => (
              <div key={group}>
                <DropdownMenu.Label className="px-3 pb-1 pt-3 text-xs font-medium uppercase tracking-wide text-text-muted">
                  {uk.hub.groups[group]}
                </DropdownMenu.Label>
                {items.map((s) => (
                  <DropdownMenu.Item key={s.id} className={item} onSelect={() => navigate(sectionPath(s.id))}>
                    <s.icon className="h-4 w-4 text-text-muted" aria-hidden="true" />
                    <span className="flex-1">{s.label}</span>
                    {current?.id === s.id && <Check className="h-4 w-4 text-primary" aria-hidden="true" />}
                  </DropdownMenu.Item>
                ))}
              </div>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}
