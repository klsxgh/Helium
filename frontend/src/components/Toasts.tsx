"use client";

import * as React from "react";
import { CircleAlert, CircleCheck, Info, X } from "lucide-react";

import { cn } from "@/lib/utils";

export type ToastTone = "success" | "error" | "info";

export interface ToastItem {
  id: string;
  message: string;
  tone: ToastTone;
}

const TONE_STYLE: Record<ToastTone, string> = {
  success: "border-emerald-500/25 bg-surface text-foreground",
  error: "border-rose-500/30 bg-surface text-foreground",
  info: "border-border bg-surface text-foreground",
};

const TONE_ICON: Record<ToastTone, React.ReactNode> = {
  success: <CircleCheck className="h-3.5 w-3.5 text-emerald-500" />,
  error: <CircleAlert className="h-3.5 w-3.5 text-rose-500" />,
  info: <Info className="h-3.5 w-3.5 text-primary" />,
};

export function Toasts({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}) {
  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-[70] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2"
      aria-live="polite"
      aria-atomic="false"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={cn(
            "pointer-events-auto flex items-start gap-2 rounded-lg border px-3 py-2.5 shadow-lg animate-fade-up",
            TONE_STYLE[toast.tone],
          )}
        >
          <span className="mt-0.5 shrink-0">{TONE_ICON[toast.tone]}</span>
          <p className="flex-1 text-[11.5px] leading-relaxed">{toast.message}</p>
          <button
            type="button"
            onClick={() => onDismiss(toast.id)}
            className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Dismiss notification"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
    </div>
  );
}
