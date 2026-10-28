"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Loader2, X } from "lucide-react";

import { Button, IconButton } from "./ui";

export interface ConfirmState {
  title: string;
  description: string;
  confirmLabel?: string;
  tone?: "danger" | "default";
  onConfirm: () => Promise<void> | void;
}

export function ConfirmDialog({
  state,
  onClose,
}: {
  state: ConfirmState | null;
  onClose: () => void;
}) {
  const [mounted, setMounted] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => setMounted(true), []);

  React.useEffect(() => {
    if (!state) return;
    setBusy(false);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [state, onClose]);

  if (!mounted || !state) return null;

  const confirm = async () => {
    setBusy(true);
    try {
      await state.onConfirm();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px] animate-fade-in"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-description"
        className="w-full max-w-[400px] rounded-xl border border-border bg-surface p-4 shadow-2xl animate-fade-up"
      >
        <div className="flex items-start gap-3">
          <span
            className={
              state.tone === "danger"
                ? "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-rose-500/25 bg-rose-500/10 text-rose-500"
                : "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-subtle text-muted-foreground"
            }
          >
            <AlertTriangle className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <h2 id="confirm-title" className="text-[13px] font-semibold">
                {state.title}
              </h2>
              <IconButton label="Close dialog" className="-mr-1 -mt-1 h-6 w-6" onClick={onClose}>
                <X className="h-3 w-3" />
              </IconButton>
            </div>
            <p id="confirm-description" className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              {state.description}
            </p>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-1.5">
          <Button size="sm" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant={state.tone === "danger" ? "danger" : "primary"}
            onClick={confirm}
            disabled={busy}
            className="gap-1.5"
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            {state.confirmLabel ?? "Confirm"}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
