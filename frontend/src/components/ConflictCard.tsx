"use client";

import * as React from "react";
import {
  ArrowRightLeft,
  CalendarClock,
  Check,
  ChevronDown,
  ExternalLink,
  Flag,
  RotateCcw,
  Scale,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";

import type { Claim, Conflict, ReviewAction } from "@/lib/api";
import { cn, formatDate, newestClaim, relationshipMeta, severityMeta } from "@/lib/utils";

import { Badge, Button, InlineMarkdown } from "./ui";

const ACTION_LABEL: Record<ReviewAction, string> = {
  accept_newest: "Newest controls",
  keep_current: "Keep current",
  flag_review: "Flag for review",
  mark_false_positive: "False positive",
  reopen: "Reopen conflict",
};

const CONFIRM_LABEL: Record<ReviewAction, string> = {
  accept_newest: "Confirm newest",
  keep_current: "Confirm current",
  flag_review: "Confirm flag",
  mark_false_positive: "Confirm false positive",
  reopen: "Reopen",
};

function ClaimPanel({
  claim,
  side,
  isNewest,
  isActive,
  onOpenCitation,
}: {
  claim: Claim;
  side: "A" | "B";
  isNewest: boolean;
  isActive: boolean;
  onOpenCitation: (chunkId: string) => void;
}) {
  return (
    <div
      className={cn(
        "relative rounded-lg border bg-surface-subtle/40 p-2.5 transition-colors",
        isActive ? "border-emerald-500/40 bg-emerald-500/[0.04]" : "border-border",
      )}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-muted font-mono text-[9px] font-semibold text-muted-foreground">
            {side}
          </span>
          <button
            type="button"
            onClick={() => onOpenCitation(claim.chunk_id)}
            className="group flex min-w-0 items-center gap-1 text-[11px] font-medium text-foreground hover:text-primary"
            title="Open the source passage"
          >
            <span className="truncate">{claim.source_filename || "Source"}</span>
            <ExternalLink className="h-2.5 w-2.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-60" />
          </button>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {isActive ? (
            <Badge tone="success" className="gap-0.5">
              <ShieldCheck className="h-2.5 w-2.5" /> controlling
            </Badge>
          ) : null}
          {isNewest ? <Badge tone="info">newest</Badge> : null}
        </div>
      </div>

      <p className="line-clamp-4 text-[11.5px] leading-relaxed text-foreground/90">
        “{claim.raw_text}”
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-1">
        <Badge tone={claim.modality === "prohibited" ? "danger" : claim.modality === "must" ? "warning" : "outline"}>
          {claim.modality}
        </Badge>
        {claim.negation ? <Badge tone="danger">negated</Badge> : null}
        {claim.numeric_constraints.slice(0, 2).map((value) => (
          <Badge key={value} tone="neutral" className="font-mono">
            {value}
          </Badge>
        ))}
        {claim.conditions.slice(0, 1).map((value) => (
          <Badge key={value} tone="warning" className="max-w-[190px] truncate" title={value}>
            if {value}
          </Badge>
        ))}
      </div>

      <div className="mt-2 flex items-center gap-2 text-[9.5px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <CalendarClock className="h-2.5 w-2.5" />
          {formatDate(claim.doc_date)}
        </span>
        <span aria-hidden>·</span>
        <span>p.{claim.page_number}</span>
        <span aria-hidden>·</span>
        <span>v{claim.version}</span>
        <span aria-hidden>·</span>
        <span className="font-mono">{Math.round((claim.confidence || 0) * 100)}% conf.</span>
      </div>
    </div>
  );
}

export function ConflictCard({
  conflict,
  onDecide,
  onOpenCitation,
  defaultExpanded = true,
  compact = false,
  className,
}: {
  conflict: Conflict;
  onDecide: (conflict: Conflict, action: ReviewAction, note?: string) => Promise<unknown> | void;
  onOpenCitation: (chunkId: string) => void;
  defaultExpanded?: boolean;
  compact?: boolean;
  className?: string;
}) {
  const [expanded, setExpanded] = React.useState(defaultExpanded);
  const [pending, setPending] = React.useState<ReviewAction | null>(null);
  const [note, setNote] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  const meta = relationshipMeta[conflict.relationship] ?? relationshipMeta.ambiguity;
  const severity = severityMeta[conflict.severity] ?? severityMeta.info;
  const newest = newestClaim(conflict);
  const isResolved = conflict.status === "resolved";
  const isFlagged = conflict.status === "flagged";
  const activeClaimId = conflict.active_claim_id;

  const confirm = async () => {
    if (!pending) return;
    setSubmitting(true);
    try {
      await onDecide(conflict, pending, note.trim() || undefined);
      setPending(null);
      setNote("");
    } catch {
      /* The parent surfaces the API error as a toast. */
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <article
      className={cn(
        "group relative overflow-hidden rounded-xl border bg-surface transition-colors",
        meta.border,
        className,
      )}
    >
      <div className={cn("absolute inset-y-0 left-0 w-[2px]", meta.dot)} />
      <div className="p-3 pl-3.5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className={cn("flex items-center gap-1.5 text-[11.5px] font-semibold", meta.tone)}>
              <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />
              {meta.short}
            </span>
            <Badge className={cn("border", severity.className)}>{severity.label}</Badge>
            {conflict.status !== "open" ? (
              <Badge
                tone={isResolved ? "success" : isFlagged ? "warning" : "neutral"}
                className="capitalize"
              >
                {conflict.status}
              </Badge>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <span className="font-mono text-[10px] text-muted-foreground">
              {Math.round(conflict.confidence * 100)}% confidence
            </span>
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label={expanded ? "Collapse conflict" : "Expand conflict"}
            >
              <ChevronDown
                className={cn("h-3.5 w-3.5 transition-transform", expanded ? "" : "-rotate-90")}
              />
            </button>
          </div>
        </div>

        <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <Scale className="h-3 w-3 shrink-0" />
          <span className="truncate">
            {conflict.claim_a.source_filename} <span className="opacity-50">vs</span>{" "}
            {conflict.claim_b.source_filename}
          </span>
        </div>

        {expanded ? (
          <>
            <div className="mt-2.5 text-[11.5px] leading-relaxed text-muted-foreground">
              <InlineMarkdown text={conflict.explanation} />
            </div>

            {conflict.mismatches.length ? (
              <div className="mt-2 flex flex-wrap gap-1">
                {conflict.mismatches.map((mismatch, index) => (
                  <span
                    key={`${mismatch.field}-${index}`}
                    title={mismatch.detail}
                    className="cursor-help rounded border border-border bg-muted/50 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-muted-foreground"
                  >
                    {mismatch.field}
                  </span>
                ))}
              </div>
            ) : null}

            <div className="mt-2.5 space-y-2">
              <ClaimPanel
                claim={conflict.claim_a}
                side="A"
                isNewest={newest.claim_id === conflict.claim_a.claim_id}
                isActive={activeClaimId === conflict.claim_a.claim_id}
                onOpenCitation={onOpenCitation}
              />
              <div className="flex items-center gap-2 pl-1 text-[9.5px] uppercase tracking-[0.2em] text-muted-foreground/70">
                <span className="h-px flex-1 bg-border" />
                <ArrowRightLeft className="h-3 w-3" />
                <span className="h-px flex-1 bg-border" />
              </div>
              <ClaimPanel
                claim={conflict.claim_b}
                side="B"
                isNewest={newest.claim_id === conflict.claim_b.claim_id}
                isActive={activeClaimId === conflict.claim_b.claim_id}
                onOpenCitation={onOpenCitation}
              />
            </div>

            {(isResolved || isFlagged) && conflict.resolution_note ? (
              <div className="mt-2.5 rounded-lg border border-border bg-surface-subtle/60 p-2 text-[10.5px] text-muted-foreground">
                <span className="font-medium text-foreground">
                  {conflict.resolved_by || "Reviewer"}:
                </span>{" "}
                {conflict.resolution_note}
                {conflict.resolved_at ? (
                  <span className="ml-1 opacity-70">· {formatDate(conflict.resolved_at)}</span>
                ) : null}
              </div>
            ) : null}

            {!compact ? (
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                {isResolved || isFlagged ? (
                  <Button
                    size="xs"
                    variant="secondary"
                    onClick={() => setPending("reopen")}
                    className="gap-1"
                  >
                    <RotateCcw className="h-3 w-3" /> Reopen
                  </Button>
                ) : (
                  <>
                    <Button
                      size="xs"
                      variant="primary"
                      onClick={() => setPending("accept_newest")}
                      className="gap-1"
                    >
                      <Sparkles className="h-3 w-3" /> Newest controls
                    </Button>
                    <Button
                      size="xs"
                      variant="secondary"
                      onClick={() => setPending("keep_current")}
                      className="gap-1"
                    >
                      <Check className="h-3 w-3" /> Keep current
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => setPending("flag_review")}
                      className="gap-1"
                    >
                      <Flag className="h-3 w-3" /> Flag
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => setPending("mark_false_positive")}
                      className="gap-1 text-muted-foreground"
                    >
                      <X className="h-3 w-3" /> False positive
                    </Button>
                  </>
                )}
              </div>
            ) : null}

            {pending ? (
              <div className="mt-2.5 animate-fade-in rounded-lg border border-border bg-surface-subtle/70 p-2.5">
                <p className="mb-1.5 text-[10.5px] font-medium text-foreground">
                  {ACTION_LABEL[pending]}
                  <span className="ml-1 font-normal text-muted-foreground">
                    — add an optional note
                  </span>
                </p>
                <textarea
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Optional reviewer note (max 2000 characters)"
                  rows={2}
                  maxLength={2000}
                  className="w-full resize-none rounded-md border border-input bg-surface px-2 py-1.5 text-[11px] text-foreground placeholder:text-muted-foreground/60 focus:border-primary/50 focus:outline-none"
                />
                <div className="mt-1.5 flex justify-end gap-1.5">
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => {
                      setPending(null);
                      setNote("");
                    }}
                  >
                    Cancel
                  </Button>
                  <Button size="xs" variant="primary" loading={submitting} onClick={confirm}>
                    {CONFIRM_LABEL[pending]}
                  </Button>
                </div>
              </div>
            ) : null}
          </>
        ) : (
          <div className="mt-2 flex items-center justify-between gap-2">
            <p className="line-clamp-1 text-[11px] text-muted-foreground">
              {conflict.claim_a.raw_text}
            </p>
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="shrink-0 text-[10px] font-medium text-primary hover:underline"
            >
              Compare
            </button>
          </div>
        )}
      </div>
    </article>
  );
}
