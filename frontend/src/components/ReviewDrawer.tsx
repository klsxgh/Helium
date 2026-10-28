"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  CircleCheck,
  ClipboardList,
  RefreshCw,
  ShieldCheck,
  UserRound,
  X,
} from "lucide-react";

import { api, type Conflict, type ReviewAction } from "@/lib/api";
import { cn } from "@/lib/utils";

import { ConflictCard } from "./ConflictCard";
import { Badge, Button, EmptyState, IconButton, Segmented, Skeleton } from "./ui";

type StatusFilter = "flagged" | "open" | "resolved" | "all";

const STATUS_OPTIONS = [
  { value: "open" as const, label: "Open" },
  { value: "flagged" as const, label: "Flagged" },
  { value: "resolved" as const, label: "Resolved" },
  { value: "all" as const, label: "All" },
];

const ISSUE_RELATIONSHIPS = new Set(["contradiction", "conditional_conflict", "ambiguity"]);

export interface ReviewDrawerProps {
  open: boolean;
  onClose: () => void;
  reviewer: string;
  onReviewerChange: (value: string) => void;
  onDecide: (conflict: Conflict, action: ReviewAction, note?: string) => Promise<unknown>;
  onOpenCitation: (chunkId: string) => void;
  onChanged: () => void;
  notify: (message: string, tone?: "success" | "error" | "info") => void;
}

export function ReviewDrawer({
  open,
  onClose,
  reviewer,
  onReviewerChange,
  onDecide,
  onOpenCitation,
  onChanged,
  notify,
}: ReviewDrawerProps) {
  const [conflicts, setConflicts] = React.useState<Conflict[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<StatusFilter>("open");
  const [refreshKey, setRefreshKey] = React.useState(0);
  const [mounted, setMounted] = React.useState(false);
  const closeRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => setMounted(true), []);

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .reviewConflicts(status)
      .then((rows) => {
        if (!cancelled) {
          setConflicts(rows.filter((row) => ISSUE_RELATIONSHIPS.has(row.relationship)));
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Unable to load the review queue.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, status, refreshKey]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const timer = window.setTimeout(() => closeRef.current?.focus(), 40);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
      window.clearTimeout(timer);
    };
  }, [open, onClose]);

  const decide = async (conflict: Conflict, action: ReviewAction, note?: string) => {
    if (!reviewer.trim()) {
      notify("Enter a reviewer name before recording a decision.", "error");
      throw new Error("Reviewer name is required.");
    }
    await onDecide(conflict, action, note);
    setRefreshKey((value) => value + 1);
    onChanged();
  };

  if (!mounted || !open) return null;

  const flagged = conflicts.filter((conflict) => conflict.status === "flagged").length;

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-[1px] animate-fade-in">
      <button
        type="button"
        aria-label="Close review panel"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
        tabIndex={-1}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="review-title"
        className="relative z-10 flex h-full w-full max-w-[560px] flex-col border-l border-border bg-background shadow-2xl animate-slide-in"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="flex items-start gap-2.5">
            <span className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg border border-amber-500/25 bg-amber-500/10 text-amber-500">
              <ClipboardList className="h-4 w-4" />
            </span>
            <div>
              <h2 id="review-title" className="text-[13px] font-semibold tracking-[-0.01em]">
                Reviewer console
              </h2>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                Resolve contradictions and record the controlling source
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {flagged > 0 ? (
              <Badge tone="warning">
                {flagged} flagged
              </Badge>
            ) : null}
            <IconButton ref={closeRef} label="Close reviewer console" onClick={onClose}>
              <X className="h-4 w-4" />
            </IconButton>
          </div>
        </div>

        <div className="shrink-0 border-b border-border px-4 py-2.5">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <UserRound className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
              <input
                value={reviewer}
                onChange={(event) => onReviewerChange(event.target.value)}
                maxLength={120}
                placeholder="Reviewer name"
                aria-label="Reviewer name"
                className="h-7 w-full rounded-md border border-input bg-surface pl-7 pr-2 text-[11px] text-foreground placeholder:text-muted-foreground/60 focus:border-primary/40 focus:outline-none"
              />
            </div>
            <span className="flex items-center gap-1 text-[9px] text-muted-foreground">
              <ShieldCheck className="h-3 w-3 text-emerald-500" /> signed decisions
            </span>
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-2">
          <Segmented
            options={STATUS_OPTIONS}
            value={status}
            onChange={(value) => setStatus(value)}
            size="sm"
          />
          <div className="flex items-center gap-1">
            <span className="hidden text-[9px] text-muted-foreground sm:inline">
              {loading ? "loading…" : `${conflicts.length} issue${conflicts.length === 1 ? "" : "s"}`}
            </span>
            <IconButton
              label="Refresh queue"
              className="h-6 w-6"
              onClick={() => setRefreshKey((value) => value + 1)}
            >
              <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
            </IconButton>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {loading && !conflicts.length ? (
              <div className="space-y-2">
                <Skeleton className="h-28 rounded-xl" />
                <Skeleton className="h-28 rounded-xl" />
                <Skeleton className="h-28 rounded-xl" />
              </div>
            ) : error ? (
              <div className="rounded-lg border border-rose-500/25 bg-rose-500/[0.04] p-4 text-center">
                <AlertTriangle className="mx-auto mb-1.5 h-4 w-4 text-rose-500" />
                <p className="text-[11px] font-medium">Unable to load the review queue</p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">{error}</p>
                <Button
                  size="xs"
                  variant="secondary"
                  className="mt-3"
                  onClick={() => setRefreshKey((value) => value + 1)}
                >
                  Retry
                </Button>
              </div>
            ) : conflicts.length === 0 ? (
              <EmptyState
                icon={
                  status === "flagged" ? (
                    <CircleCheck className="h-4 w-4 text-emerald-500" />
                  ) : (
                    <ClipboardList className="h-4 w-4" />
                  )
                }
                title={status === "flagged" ? "Review queue is clear" : "No conflicts in this view"}
                description={
                  status === "flagged"
                    ? "No conflicts are currently flagged. Ask a question to run fresh contradiction analysis, or inspect open issues."
                    : "Try another status filter. Conflicts appear after a question is analyzed against contradictory sources."
                }
                className="border-border/70"
                action={
                  status === "flagged" ? (
                    <Button size="sm" variant="secondary" onClick={() => setStatus("open")}>
                      View open issues
                    </Button>
                  ) : null
                }
              />
            ) : (
              <div className="space-y-2">
                <p className="mb-1 flex items-center gap-1.5 rounded-lg border border-amber-500/20 bg-amber-500/[0.05] px-2.5 py-1.5 text-[9.5px] leading-relaxed text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="h-3 w-3 shrink-0" />
                  Choose a controlling source or escalate. Helium does not choose a winner
                  automatically.
                </p>
                {conflicts.map((conflict) => (
                  <ConflictCard
                    key={conflict.id}
                    conflict={conflict}
                    onDecide={decide}
                    onOpenCitation={onOpenCitation}
                    defaultExpanded={false}
                  />
                ))}
              </div>
            )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
