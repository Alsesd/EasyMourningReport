import { cn } from "@/ui/utils";

const tones = {
  ok: "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.7)]",
  busy: "bg-amber-500 motion-safe:animate-pulse",
  error: "bg-destructive",
  idle: "bg-text-muted/40",
} as const;

/** A small coloured status light. Always pair it with a text label. */
export function StateDot({ tone, className }: { tone: keyof typeof tones; className?: string }) {
  return <span aria-hidden="true" className={cn("inline-block h-2.5 w-2.5 shrink-0 rounded-full", tones[tone], className)} />;
}
