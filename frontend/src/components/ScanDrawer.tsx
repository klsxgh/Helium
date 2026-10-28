"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CheckCircle2, GitCompare, ScanSearch, X } from "lucide-react";

import type { Conflict, ReviewAction, ScanResult } from "@/lib/api";
import { cn } from "@/lib/utils";

import { ConflictCard } from "./ConflictCard";
import { Badge, Button, EmptyState, IconButton, Skeleton } from "./ui";

const COUNT_ROWS: Array<{ key: string; label: string; tone: string }> = [
  { key: "contradiction", label: "Contradictions", tone: "text-rose-500" },
  { key: "conditional_conflict", label: "Conditional", tone: "text-orange-500" },
  { key: "ambiguity", label: "Ambiguity", tone: "text-amber-500" },
  { key: "agreement", label: "Agreements", tone: "text-emerald-500" },
  { key: "equivalence", label: "Equivalences", tone: "text-sky-500" },
];

export interface ScanDrawerProps {
  open: boolean;
  loading: boolean;
  result: ScanResult | null;
  error: string | null;
  onClose: () => void;
  onDecide: (conflict: Conflict, action: ReviewAction, note?: string) => Promise<unknown>;
  onOpenCitation: (chunkId: string) => void;
  onOpenReview: () => void;
}

export function ScanDrawer({
  open,
  loading,
  result,
  error,
  onClose,
  onDecide,
  onOpenCitation,
  onOpenReview,
}: ScanDrawerProps) {
  const [mounted, setMounted] = React.useState(false);
  const closeRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => setMounted(true), []);

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

  if (!mounted || !open) return null;

  const counts = result?.counts ?? {};
  const issues = result?.conflicts ?? [];
  const otherPairs = Math.max(
    0,
    (result?.relationships.length ?? 0) - issues.length,
  );

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-[1px] animate-fade-in">
      <button
        type="button"
        aria-label="Close scan results"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
        tabIndex={-1}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="scan-title"
        className="relative z-10 flex h-full w-full max-w-[620px] flex-col border-l border-border bg-background shadow-2xl animate-slide-in"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="flex items-start gap-2.5">
            <span className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg border border-primary/25 bg-primary/10 text-primary">
              <ScanSearch className="h-4 w-4" />
            </span>
            <div>
              <h2 id="scan-title" className="text-[13px] font-semibold tracking-[-0.01em]">
                Contradiction scan
              </h2>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                Every claim in the selected files, compared with the other files
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {issues.length ? <Badge tone="warning">{issues.length} found</Badge> : null}
            <IconButton ref={closeRef} label="Close scan results" onClick={onClose}>
              <X className="h-4 w-4" />
            </IconButton>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {loading ? (
            <div className="space-y-2.5">
              <Skeleton className="h-16 w-full rounded-xl" />
              {Array.from({ length: 3 }).map((_, index) => (
                <Skeleton key={index} className="h-20 w-full rounded-xl" />
              ))}
            </div>
          ) : error ? (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/[0.05] p-3 text-[11px] text-rose-500">
              {error}
            </div>
          ) : result ? (
            <div className="space-y-3">
              <div className="rounded-xl border border-border bg-surface-subtle/40 p-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <GitCompare className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  {result.document_names.map((name) => (
                    <span
                      key={name}
                      className="max-w-full truncate rounded border border-border bg-surface px-1.5 py-0.5 text-[10px] text-foreground/90"
                      title={name}
                    >
                      {name}
                    </span>
                  ))}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                  <span>
                    <span className="font-mono text-foreground">{result.claims_analyzed}</span>{" "}
                    claims
                  </span>
                  <span aria-hidden>·</span>
                  <span>
                    <span className="font-mono text-foreground">{result.pairs_analyzed}</span>{" "}
                    cross-file pairs
                  </span>
                  <span aria-hidden>·</span>
                  <span>
                    <span className="font-mono text-foreground">{result.consistency_score}%</span>{" "}
                    consistency
                  </span>
                </div>
                <div className="mt-2.5 grid grid-cols-5 gap-1.5">
                  {COUNT_ROWS.map((row) => (
                    <div
                      key={row.key}
                      className="rounded-lg border border-border bg-surface px-1.5 py-1.5 text-center"
                    >
                      <p className={cn("font-mono text-[13px] font-semibold tabular", row.tone)}>
                        {counts[row.key] ?? 0}
                      </p>
                      <p className="mt-0.5 truncate text-[8.5px] uppercase tracking-wide text-muted-foreground">
                        {row.label}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              {issues.length ? (
                <div className="space-y-2">
                  <p className="px-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                    Issues between files
                  </p>
                  {issues.map((conflict, index) => (
                    <ConflictCard
                      key={conflict.id}
                      conflict={conflict}
                      onDecide={onDecide}
                      onOpenCitation={onOpenCitation}
                      defaultExpanded={index === 0}
                    />
                  ))}
                </div>
              ) : result.claims_analyzed < 2 ? (
                <EmptyState
                  icon={<AlertTriangle className="h-4 w-4" />}
                  title="Not enough claims to compare"
                  description="The selected files contain too few extractable claims. Try scanning longer policy documents."
                />
              ) : (
                <EmptyState
                  icon={<CheckCircle2 className="h-4 w-4 text-emerald-500" />}
                  title="No contradictions found"
                  description={`The selected files agree on every claim they share. ${otherPairs} matching pair${otherPairs === 1 ? "" : "s"} were classified as agreement or equivalence.`}
                />
              )}

              {issues.length && otherPairs > 0 ? (
                <p className="px-0.5 text-[10px] text-muted-foreground">
                  Plus {otherPairs} matching pair{otherPairs === 1 ? "" : "s"} classified as
                  agreement or equivalence.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border px-4 py-2.5">
          <p className="min-w-0 flex-1 truncate text-[9.5px] text-muted-foreground">
            {result ? "Saved to the review queue" : "Select files, then scan"}
          </p>
          <Button size="xs" variant="secondary" onClick={onOpenReview} className="gap-1">
            Review queue
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
