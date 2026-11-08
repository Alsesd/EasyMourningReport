/**
 * A panel anchored to its trigger on wide screens (bell, quick lists) and a bottom sheet on phones, where an anchored
 * popover would be cramped and unreachable by thumb. One component, so callers write the content once.
 */

import * as PopoverPrimitive from "@radix-ui/react-popover";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/ui/Dialog";
import { useIsWide } from "@/ui/useMediaQuery";
import { cn } from "@/ui/utils";

interface PanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The element that opens the panel (a button; it receives the open/close behaviour and the anchor). */
  trigger: ReactNode;
  title: string;
  children: ReactNode;
  /** Which edge of the trigger the panel lines up with on wide screens. */
  align?: "start" | "center" | "end";
  side?: "top" | "right" | "bottom" | "left";
  className?: string;
}

export function AnchoredPanel({ open, onOpenChange, trigger, title, children, align = "end", side = "bottom", className }: PanelProps) {
  const wide = useIsWide();
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <PopoverPrimitive.Trigger asChild>{trigger}</PopoverPrimitive.Trigger>
      {wide ? (
        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Content
            side={side}
            align={align}
            sideOffset={8}
            collisionPadding={12}
            aria-label={title}
            className={cn("popover-panel", className)}
          >
            <div className="flex items-center justify-between gap-2 border-b border-border py-1 pl-4 pr-1">
              <h2 className="font-serif text-base font-semibold text-text-main">{title}</h2>
              <PopoverPrimitive.Close
                aria-label="Закрити"
                className="grid h-11 w-11 place-items-center rounded-control text-text-muted transition-colors hover:bg-surface-raised hover:text-text-main focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </PopoverPrimitive.Close>
            </div>
            {children}
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      ) : (
        <Dialog open={open} onOpenChange={onOpenChange}>
          <DialogContent className={cn("gap-3", className)}>
            <DialogHeader>
              <DialogTitle>{title}</DialogTitle>
            </DialogHeader>
            {children}
          </DialogContent>
        </Dialog>
      )}
    </PopoverPrimitive.Root>
  );
}
