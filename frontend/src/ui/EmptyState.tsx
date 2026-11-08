import type { ReactNode } from "react";
import { cn } from "@/ui/utils";

/** Nothing here yet: says what is missing and, when there is one, offers the action that fills it. */
export function EmptyState({ title, text, action, className }: { title: string; text?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("px-2 py-10 text-center", className)}>
      <p className="font-serif text-lg text-text-main">{title}</p>
      {text && <p className="mx-auto mt-1 max-w-[34ch] text-sm text-text-muted">{text}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}
