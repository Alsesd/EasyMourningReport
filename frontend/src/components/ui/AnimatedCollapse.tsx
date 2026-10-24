import React, { useEffect, useState, useRef } from "react";
import { cn } from "@/lib/utils";

export interface AnimatedCollapseProps {
  open: boolean;
  children: React.ReactNode;
  className?: string;
  innerClassName?: string;
  durationMs?: number;
  unmountOnExit?: boolean;
}

/**
 * AnimatedCollapse provides smooth, 60fps hardware-accelerated expansion
 * and collapse transitions for dynamically spawned fields, cards, and foldouts.
 *
 * Uses CSS grid-template-rows (0fr -> 1fr) with opacity and subtle vertical translation,
 * ensuring fluid animations without hardcoding fixed pixel heights.
 */
export function AnimatedCollapse({
  open,
  children,
  className,
  innerClassName,
  durationMs = 260,
  unmountOnExit = true,
}: AnimatedCollapseProps) {
  const [isRendered, setIsRendered] = useState(open);
  const [isOpenState, setIsOpenState] = useState(open);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastChildrenRef = useRef<React.ReactNode>(children);

  if (children) {
    lastChildrenRef.current = children;
  }

  useEffect(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    if (open) {
      setIsRendered(true);
      // Small frame delay to let initial 0fr mount before animating to 1fr
      const timer = setTimeout(() => {
        setIsOpenState(true);
      }, 15);
      return () => clearTimeout(timer);
    } else {
      setIsOpenState(false);
      if (unmountOnExit) {
        timeoutRef.current = setTimeout(() => {
          setIsRendered(false);
        }, durationMs);
      }
    }

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [open, durationMs, unmountOnExit]);

  if (unmountOnExit && !isRendered && !open) {
    return null;
  }

  const displayChildren = children ?? lastChildrenRef.current;

  return (
    <div
      className={cn(
        "grid transition-all ease-[cubic-bezier(0.16,1,0.3,1)]",
        isOpenState
          ? "grid-rows-[1fr] opacity-100 translate-y-0"
          : "grid-rows-[0fr] opacity-0 -translate-y-1 pointer-events-none",
        className
      )}
      style={{
        transitionDuration: `${durationMs}ms`,
      }}
      aria-hidden={!open}
    >
      <div className={cn("overflow-hidden min-h-0", innerClassName)}>
        {displayChildren}
      </div>
    </div>
  );
}
