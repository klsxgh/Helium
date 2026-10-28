"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import {
  CalendarClock,
  Check,
  Copy,
  ExternalLink,
  FileText,
  Hash,
  Loader2,
  Maximize2,
  Quote,
  X,
} from "lucide-react";

import { api, type ChunkDetail } from "@/lib/api";
import { cn, formatDate, formatDateTime, relativeTime } from "@/lib/utils";

import { Badge, Button, IconButton, Skeleton } from "./ui";

export interface CitationTarget {
  chunkId: string;
  quote?: string;
  label?: string;
}

export function CitationModal({
  target,
  onClose,
}: {
  target: CitationTarget | null;
  onClose: () => void;
}) {
  const [chunk, setChunk] = React.useState<ChunkDetail | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [expanded, setExpanded] = React.useState(false);
  const [attempt, setAttempt] = React.useState(0);
  const closeRef = React.useRef<HTMLButtonElement>(null);
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  React.useEffect(() => {
    if (!target) return;
    setChunk(null);
    setError(null);
    setLoading(true);
    setExpanded(false);
    const controller = new AbortController();
    api
      .citation(target.chunkId)
      .then((data) => {
        if (!controller.signal.aborted) setChunk(data);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "The source passage could not be loaded.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [target, attempt]);

  React.useEffect(() => {
    if (!target) return;
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
  }, [target, onClose]);

  const copy = async () => {
    if (!chunk) return;
    try {
      await navigator.clipboard.writeText(chunk.text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* ignore */
    }
  };

  if (!mounted || !target) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-0 backdrop-blur-[2px] animate-fade-in sm:items-center sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="citation-title"
        className="flex max-h-[92dvh] w-full max-w-[720px] flex-col overflow-hidden rounded-t-2xl border border-border bg-surface shadow-2xl animate-fade-up sm:max-h-[84dvh] sm:rounded-2xl"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="flex min-w-0 items-start gap-2.5">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/[0.07] text-primary">
              <FileText className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                {target.label ? (
                  <Badge tone="info" className="font-mono">
                    {target.label}
                  </Badge>
                ) : null}
                {chunk ? (
                  <>
                    <Badge tone="outline">page {chunk.page_number}</Badge>
                    <Badge tone="outline">v{chunk.version}</Badge>
                    <Badge tone="outline" className="font-mono">
                      {chunk.token_count} tokens
                    </Badge>
                  </>
                ) : null}
              </div>
              <h2
                id="citation-title"
                className="mt-1 truncate text-[13px] font-semibold tracking-[-0.01em] text-foreground"
                title={chunk?.filename ?? "Source passage"}
              >
                {chunk?.filename ?? (loading ? "Loading source…" : "Source passage")}
              </h2>
              {chunk?.section_heading ? (
                <p className="mt-0.5 flex items-center gap-1 truncate text-[10px] text-muted-foreground">
                  <Quote className="h-2.5 w-2.5 shrink-0" /> {chunk.section_heading}
                </p>
              ) : null}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <IconButton
              label={expanded ? "Collapse width" : "Widen viewer"}
              onClick={() => setExpanded((value) => !value)}
              className="hidden sm:inline-flex"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </IconButton>
            <IconButton label="Copy passage" onClick={copy} disabled={!chunk}>
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
            </IconButton>
            <IconButton ref={closeRef} label="Close source viewer" onClick={onClose}>
              <X className="h-4 w-4" />
            </IconButton>
          </div>
        </div>

        {chunk ? (
          <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-surface-subtle/40 px-4 py-1.5 text-[9.5px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <CalendarClock className="h-2.5 w-2.5" />
              Dated {formatDate(chunk.doc_date)}
            </span>
            <span className="flex items-center gap-1">
              <Hash className="h-2.5 w-2.5" /> chunk {chunk.chunk_index + 1}
            </span>
            <span>Uploaded {formatDateTime(chunk.uploaded_at)}</span>
            <span className="ml-auto flex items-center gap-1">
              <ExternalLink className="h-2.5 w-2.5" /> read-only source
            </span>
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-[96%]" />
              <Skeleton className="h-3 w-[88%]" />
              <Skeleton className="h-3 w-[93%]" />
              <Skeleton className="h-3 w-[70%]" />
              <div className="flex items-center gap-1.5 pt-2 text-[10px] text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Fetching the indexed passage…
              </div>
            </div>
          ) : error ? (
            <div className="rounded-lg border border-rose-500/25 bg-rose-500/[0.05] p-4 text-center">
              <p className="text-[12px] font-medium text-foreground">Unable to load this source</p>
              <p className="mt-1 text-[10.5px] text-muted-foreground">{error}</p>
              <Button
                size="xs"
                variant="secondary"
                className="mt-3"
                onClick={() => setAttempt((value) => value + 1)}
              >
                Try again
              </Button>
            </div>
          ) : chunk ? (
            <>
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="micro-label">Indexed passage</p>
                <span className="text-[9px] text-muted-foreground">
                  {chunk.text.length.toLocaleString()} characters
                </span>
              </div>
              <div
                className={cn(
                  "rounded-lg border border-border bg-surface-subtle/40 px-4 py-3 text-[12.5px] leading-[1.8] text-foreground/90",
                  expanded && "sm:text-[13px]",
                )}
              >
                {chunk.text.split(/\n{2,}/).map((paragraph, index) => (
                  <p key={index} className={cn(index > 0 && "mt-3")}>
                    {paragraph}
                  </p>
                ))}
              </div>
              {target.quote ? (
                <div className="mt-3 rounded-lg border border-primary/20 bg-primary/[0.04] px-3 py-2">
                  <p className="micro-label mb-1 text-primary/80">Cited by the answer</p>
                  <p className="text-[11px] leading-relaxed text-muted-foreground">“{target.quote}”</p>
                </div>
              ) : null}
            </>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border px-4 py-2.5">
          <div className="min-w-0">
            <p className="truncate font-mono text-[8.5px] text-muted-foreground/70">
              {chunk ? `${chunk.id} · ${chunk.document_id}` : "—"}
            </p>
            <p className="text-[8.5px] text-muted-foreground/60">
              {chunk ? `Indexed ${relativeTime(chunk.uploaded_at)}` : "Source metadata"}
            </p>
          </div>
          <Button size="sm" variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
