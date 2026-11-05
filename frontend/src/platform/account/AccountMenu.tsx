/** The signed-in user's menu: who you are, change password, sign out. Used by every layout. */

import { useRef, useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { KeyRound, LogOut } from "lucide-react";
import { useAuth } from "@/platform/auth/AuthContext";
import { ukPlatform as uk } from "@/platform/i18n";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/ui/Dialog";
import { cn } from "@/ui/utils";
import { PasswordForm } from "./PasswordForm";

export function AccountMenu({ variant = "header" }: { variant?: "header" | "sidebar" }) {
  const { session, logout } = useAuth();
  const [passwordOpen, setPasswordOpen] = useState(false);
  // The dialog opens only once the menu has fully closed; opening it from inside the closing menu
  // leaves the menu's layer on top, which swallows Escape and keeps the overlay stuck.
  const openPasswordAfterClose = useRef(false);
  if (!session) return null;

  const name = session.full_name || session.login;
  const context = session.organisation?.name ?? uk.account.platformStaff;
  const initial = name.slice(0, 1).toLocaleUpperCase("uk-UA");
  const itemClass =
    "flex min-h-[44px] cursor-pointer items-center gap-2 rounded-control px-3 text-sm text-text-main outline-none data-[highlighted]:bg-page";

  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          aria-label={`${uk.account.menuLabel}: ${name}`}
          className={cn(
            "flex min-h-[44px] min-w-0 items-center gap-2.5 rounded-control text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
            variant === "sidebar" ? "w-full px-2.5 py-2 hover:bg-white/[0.06]" : "px-1.5 hover:bg-page",
          )}
        >
          <span
            className={cn(
              "grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-semibold",
              variant === "sidebar"
                ? "border border-white/15 bg-white/[0.07] text-[#e4d1aa]"
                : "border border-border bg-surface text-primary",
            )}
            aria-hidden="true"
          >
            {initial}
          </span>
          <span className={cn("min-w-0", variant === "header" && "hidden sm:block")}>
            <span className={cn("block truncate text-xs font-semibold", variant === "sidebar" ? "text-[#f1f2e9]" : "text-text-main")}>
              {name}
            </span>
            <span className={cn("block truncate text-[10px] tracking-wide", variant === "sidebar" ? "text-[#afc1b2]" : "text-text-muted")}>
              {context}
            </span>
          </span>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            onCloseAutoFocus={(event) => {
              if (openPasswordAfterClose.current) {
                openPasswordAfterClose.current = false;
                event.preventDefault();
                setPasswordOpen(true);
              }
            }}
            align={variant === "sidebar" ? "start" : "end"}
            side={variant === "sidebar" ? "top" : "bottom"}
            sideOffset={6}
            className="z-50 min-w-[220px] rounded-card border border-border bg-surface p-1.5 shadow-lg"
          >
            <div className="px-3 py-2">
              <p className="truncate text-sm font-semibold text-text-main">{name}</p>
              <p className="truncate text-xs text-text-muted">
                {session.login} · {context}
              </p>
            </div>
            <DropdownMenu.Separator className="my-1 h-px bg-border" />
            <DropdownMenu.Item className={itemClass} onSelect={() => (openPasswordAfterClose.current = true)}>
              <KeyRound className="h-4 w-4 text-text-muted" aria-hidden="true" />
              {uk.account.changePassword}
            </DropdownMenu.Item>
            <DropdownMenu.Item className={cn(itemClass, "text-destructive")} onSelect={() => logout()}>
              <LogOut className="h-4 w-4" aria-hidden="true" />
              {uk.auth.logoutButton}
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      <Dialog open={passwordOpen} onOpenChange={setPasswordOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{uk.account.title}</DialogTitle>
          </DialogHeader>
          <PasswordForm />
        </DialogContent>
      </Dialog>
    </>
  );
}
