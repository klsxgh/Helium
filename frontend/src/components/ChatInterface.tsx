"use client";

import * as React from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowUp,
  ArrowUpRight,
  Check,
  ChevronRight,
  CircleAlert,
  Copy,
  FileSearch,
  GitCompareArrows,
  Layers,
  Loader2,
  PanelRight,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Square,
  Wand2,
} from "lucide-react";

import type { Citation } from "@/lib/api";
import { reportOf, type ChatEntry } from "@/lib/chat";
import {
  cn,
  formatMs,
  healthColor,
  healthLabel,
  pluralize,
  relationshipMeta,
  relativeTime,
} from "@/lib/utils";

import { Badge, Button, IconButton, Skeleton } from "./ui";

const SAMPLE_QUERIES = [
  "Are remote employees required to use company-issued devices?",
  "How many vacation days carry over?",
  "What is the meal reimbursement limit during travel?",
];

const STAGES = [
  { key: "retrieving", label: "Retrieve evidence", detail: "FAISS vector search" },
  { key: "analyzing", label: "Structure claims", detail: "Entities, modality, numerics" },
  { key: "generating", label: "Synthesize answer", detail: "Grounded synthesis" },
] as const;

function stageIndex(stage: string): number {
  if (stage === "generating" || stage === "streaming") return 2;
  if (stage === "analyzing") return 1;
  return 0;
}

function MarkdownBody({
  content,
  onOpenCitation,
}: {
  content: string;
  onOpenCitation: (chunkId: string) => void;
}) {
  const components = React.useMemo<Components>(
    () => ({
      a: ({ href, children }) => {
        if (href?.startsWith("citation:")) {
          const chunkId = href.slice("citation:".length);
          return (
            <button
              type="button"
              onClick={() => onOpenCitation(chunkId)}
              className="citation-pill"
              title="Open cited source"
            >
              {children}
            </button>
          );
        }
        return (
          <a href={href} target="_blank" rel="noreferrer noopener">
            {children}
          </a>
        );
      },
      h3: ({ children }) => (
        <h3 className="mt-4 text-[10px] font-semibold uppercase tracking-[0.13em] text-muted-foreground first:mt-0">
          {children}
        </h3>
      ),
      table: ({ children }) => (
        <div className="my-3 overflow-x-auto">
          <table>{children}</table>
        </div>
      ),
    }),
    [onOpenCitation],
  );

  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={components}
        urlTransform={(url) => url}
        skipHtml
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function StreamSteps({ entry }: { entry: ChatEntry }) {
  const current = stageIndex(entry.stage);
  return (
    <div className="space-y-2.5">
      <div className="flex flex-col gap-1.5">
        {STAGES.map((stage, index) => {
          const done = index < current;
          const active = index === current;
          return (
            <div key={stage.key} className="flex items-center gap-2">
              <span
                className={cn(
                  "flex h-4 w-4 items-center justify-center rounded-full border",
                  done
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-500"
                    : active
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border text-muted-foreground/40",
                )}
              >
                {done ? (
                  <Check className="h-2.5 w-2.5" />
                ) : active ? (
                  <Loader2 className="h-2.5 w-2.5 animate-spin" />
                ) : (
                  <span className="h-1 w-1 rounded-full bg-current" />
                )}
              </span>
              <span
                className={cn(
                  "text-[11.5px] font-medium",
                  active ? "text-foreground" : done ? "text-muted-foreground" : "text-muted-foreground/50",
                )}
              >
                {stage.label}
              </span>
              <span className="text-[10px] text-muted-foreground/60">{stage.detail}</span>
            </div>
          );
        })}
      </div>
      <p className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/60" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
        </span>
        {entry.statusText}
      </p>
      <div className="space-y-1.5 pt-1">
        <Skeleton className="h-2.5 w-full" />
        <Skeleton className="h-2.5 w-[92%]" />
        <Skeleton className="h-2.5 w-[76%]" />
      </div>
    </div>
  );
}

function AnalysisPreview({ entry }: { entry: ChatEntry }) {
  const report = reportOf(entry);
  if (!report) return null;
  const issues = report.conflicts.length;
  const color = healthColor(report.consistency_score);
  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-surface-subtle/60 px-2.5 py-1.5">
      <ShieldCheck className="h-3 w-3" style={{ color }} />
      <span className="tabular font-mono text-[10.5px] font-medium" style={{ color }}>
        {report.consistency_score}% consistent
      </span>
      <span className="text-muted-foreground/40">·</span>
      <span className="text-[10px] text-muted-foreground">
        {pluralize(report.citations.length, "passage")} · {pluralize(report.claims.length, "claim")}
      </span>
      {issues > 0 ? (
        <Badge tone="danger" className="ml-auto">
          {issues} issue{issues === 1 ? "" : "s"}
        </Badge>
      ) : (
        <Badge tone="success" className="ml-auto">
          no material conflicts
        </Badge>
      )}
    </div>
  );
}

function CitationStrip({
  citations,
  onOpen,
  onInspect,
}: {
  citations: Citation[];
  onOpen: (chunkId: string) => void;
  onInspect: () => void;
}) {
  if (!citations.length) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border pt-2.5">
      <span className="mr-0.5 flex items-center gap-1 text-[9.5px] uppercase tracking-[0.1em] text-muted-foreground">
        <Layers className="h-3 w-3" /> Sources
      </span>
      {citations.map((citation) => (
        <button
          key={citation.chunk_id}
          type="button"
          onClick={() => onOpen(citation.chunk_id)}
          className="citation-pill"
          title={`${citation.filename} · page ${citation.page_number}`}
        >
          {citation.label}
        </button>
      ))}
      <button
        type="button"
        onClick={onInspect}
        className="ml-auto inline-flex items-center gap-0.5 text-[9.5px] font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        All passages <ChevronRight className="h-3 w-3" />
      </button>
    </div>
  );
}

function ConflictRibbon({
  entry,
  onInspect,
}: {
  entry: ChatEntry;
  onInspect: () => void;
}) {
  const report = reportOf(entry);
  if (!report) return null;
  const counts: Record<string, number> = {};
  report.conflicts.forEach((conflict) => {
    counts[conflict.relationship] = (counts[conflict.relationship] ?? 0) + 1;
  });
  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!rows.length) {
    return (
      <button
        type="button"
        onClick={onInspect}
        className="group mt-3 flex w-full items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.05] px-2.5 py-2 text-left transition-colors hover:bg-emerald-500/[0.08]"
      >
        <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
        <span className="text-[10.5px] text-emerald-600 dark:text-emerald-400">
          Relationship checks found no material conflict for this question.
        </span>
        <ChevronRight className="ml-auto h-3 w-3 text-emerald-500/60" />
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onInspect}
      className="group mt-3 w-full rounded-lg border border-rose-500/20 bg-rose-500/[0.04] px-2.5 py-2 text-left transition-colors hover:bg-rose-500/[0.07]"
    >
      <div className="flex items-center gap-1.5">
        <GitCompareArrows className="h-3.5 w-3.5 text-rose-500" />
        <span className="text-[10.5px] font-medium text-rose-500">
          Consistency report · {pluralize(report.conflicts.length, "issue")}
        </span>
        <ChevronRight className="ml-auto h-3 w-3 text-rose-500/60 transition-transform group-hover:translate-x-0.5" />
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {rows.map(([relationship, count]) => {
          const meta = relationshipMeta[relationship as keyof typeof relationshipMeta];
          return (
            <span
              key={relationship}
              className="rounded border border-border/70 bg-surface/70 px-1.5 py-0.5 text-[9px] text-muted-foreground"
            >
              <span className={cn("mr-1 inline-block h-1 w-1 rounded-full align-middle", meta?.dot)} />
              {count} {meta?.short.toLowerCase() ?? relationship.replace("_", " ")}
            </span>
          );
        })}
      </div>
    </button>
  );
}

function EntryFooter({
  entry,
  onInspect,
  onRetry,
}: {
  entry: ChatEntry;
  onInspect: () => void;
  onRetry: () => void;
}) {
  const [copied, setCopied] = React.useState(false);
  const report = reportOf(entry);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(entry.answer);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* Clipboard may be unavailable over insecure origins. */
    }
  };

  if (entry.state === "error") {
    return (
      <div className="mt-2 flex items-center justify-between gap-2 border-t border-border pt-2">
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1 text-[10.5px] font-medium text-rose-500 hover:underline"
        >
          <RefreshCw className="h-3 w-3" /> Retry question
        </button>
        <span className="text-[9.5px] text-muted-foreground">{relativeTime(entry.createdAt)}</span>
      </div>
    );
  }

  if (entry.state === "streaming") {
    return (
      <div className="mt-2 flex items-center gap-2 border-t border-border pt-2 text-[9.5px] text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin text-primary" />
        Streaming grounded response…
      </div>
    );
  }

  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border pt-2">
      {report ? (
        <>
          <span className="tabular flex items-center gap-1 font-mono text-[9.5px] text-muted-foreground">
            <Layers className="h-2.5 w-2.5" />
            {pluralize(report.citations.length, "passage")}
          </span>
          <span className="text-muted-foreground/30">·</span>
          <span className="tabular font-mono text-[9.5px] text-muted-foreground">
            {formatMs(report.metrics?.total_ms ?? entry.elapsedMs ?? 0)}
          </span>
        </>
      ) : null}
      <span className="ml-auto flex items-center gap-1">
        <IconButton label="Copy answer" className="h-6 w-6" onClick={copy}>
          {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
        </IconButton>
        <IconButton label="Re-run question" className="h-6 w-6" onClick={onRetry}>
          <RefreshCw className="h-3 w-3" />
        </IconButton>
        <IconButton label="Open consistency report" className="h-6 w-6" onClick={onInspect}>
          <PanelRight className="h-3 w-3" />
        </IconButton>
      </span>
    </div>
  );
}

function AssistantEntry({
  entry,
  selected,
  onOpenCitation,
  onInspect,
  onRetry,
}: {
  entry: ChatEntry;
  selected: boolean;
  onOpenCitation: (chunkId: string) => void;
  onInspect: () => void;
  onRetry: () => void;
}) {
  const report = reportOf(entry);
  const streaming = entry.state === "streaming";
  const hasAnswer = Boolean(entry.answer);

  return (
    <div className="flex gap-2.5">
      <div className="relative mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border bg-surface shadow-sm">
        <span className="bg-gradient-to-br from-sky-400 to-blue-600 bg-clip-text text-[10px] font-bold text-transparent">
          He
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-1.5">
          <span className="text-[11px] font-semibold text-foreground">Helium</span>
          {entry.state === "complete" ? (
            <Badge tone="success" className="gap-0.5 py-0">
              <Check className="h-2.5 w-2.5" /> grounded
            </Badge>
          ) : null}
          {entry.state === "stopped" ? (
            <Badge tone="warning" className="py-0">
              stopped
            </Badge>
          ) : null}
          <span className="text-[9.5px] text-muted-foreground">
            {relativeTime(entry.result?.created_at || entry.createdAt)}
          </span>
          {report && !streaming ? (
            <span
              className="ml-auto flex items-center gap-1 font-mono text-[9.5px]"
              style={{ color: healthColor(report.consistency_score) }}
              title="Weighted share of related claim pairs that are not in direct conflict. Open the report to see the full breakdown."
            >
              <span
                className="h-1 w-1 rounded-full"
                style={{ backgroundColor: healthColor(report.consistency_score) }}
              />
              {report.consistency_score}% · {healthLabel(report.consistency_score)}
            </span>
          ) : null}
        </div>

        <div
          className={cn(
            "rounded-xl border bg-surface px-3.5 py-3 shadow-sm transition-colors",
            selected ? "border-primary/30 ring-1 ring-primary/10" : "border-border",
            entry.state === "error" && "border-rose-500/30 bg-rose-500/[0.02]",
          )}
        >
          {entry.state === "error" && !hasAnswer ? (
            <div className="flex items-start gap-2">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
              <div>
                <p className="text-[12px] font-medium text-foreground">The query could not be completed.</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                  {entry.error || "An unexpected error occurred while analyzing the corpus."}
                </p>
              </div>
            </div>
          ) : null}

          {streaming && !hasAnswer ? <StreamSteps entry={entry} /> : null}

          {hasAnswer ? (
            <>
              {report && streaming ? <AnalysisPreview entry={entry} /> : null}
              <MarkdownBody content={entry.answer} onOpenCitation={onOpenCitation} />
              {streaming ? (
                <span className="ml-0.5 inline-block h-3 w-[2px] animate-blink bg-primary align-middle" />
              ) : null}
            </>
          ) : null}

          {entry.state === "stopped" && !hasAnswer ? (
            <p className="text-[11px] text-muted-foreground">
              Generation was stopped before an answer was produced. Re-run the question to try again.
            </p>
          ) : null}

          {report && !streaming ? (
            <>
              <ConflictRibbon entry={entry} onInspect={onInspect} />
              <CitationStrip
                citations={report.citations}
                onOpen={onOpenCitation}
                onInspect={onInspect}
              />
            </>
          ) : null}

          <EntryFooter entry={entry} onInspect={onInspect} onRetry={onRetry} />
        </div>
      </div>
    </div>
  );
}

export function EmptyConversation({
  hasDocuments,
  onSeedDemo,
  seeding,
  onAsk,
}: {
  hasDocuments: boolean;
  onSeedDemo: () => void;
  seeding: boolean;
  onAsk: (query: string) => void;
}) {
  return (
    <div className="mx-auto flex min-h-full w-full max-w-[720px] flex-col items-center justify-center px-5 py-10 text-center">
      <h1 className="text-balance text-[24px] font-semibold tracking-[-0.03em] text-foreground">
        Ask your policy library
      </h1>
      <p className="mt-2 max-w-[430px] text-balance text-[12.5px] leading-relaxed text-muted-foreground">
        Get a grounded answer with citations, plus a clear report when your sources disagree.
      </p>

      {!hasDocuments ? (
        <div className="mt-5 flex flex-col items-center gap-2">
          <Button variant="primary" size="sm" loading={seeding} onClick={onSeedDemo} className="gap-1.5">
            <Sparkles className="h-3.5 w-3.5" /> Load the demo corpus
          </Button>
          <p className="text-[10px] text-muted-foreground">
            Three policies with intentional contradictions, ready to inspect.
          </p>
        </div>
      ) : null}

      <div data-tour="samples" className="mt-7 grid w-full gap-2 sm:grid-cols-3">
        {SAMPLE_QUERIES.map((query) => (
          <button
            key={query}
            type="button"
            onClick={() => onAsk(query)}
            disabled={!hasDocuments}
            title={!hasDocuments ? "Load a source or the demo corpus first" : undefined}
            className={cn(
              "group flex items-start gap-2 rounded-xl border border-border bg-surface/70 px-3 py-2.5 text-left shadow-sm transition-all hover:-translate-y-px hover:border-primary/30 hover:shadow-md",
              !hasDocuments && "cursor-not-allowed opacity-50 hover:translate-y-0 hover:border-border hover:shadow-sm",
            )}
          >
            <FileSearch className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
            <span className="flex-1 text-[11.5px] leading-snug text-foreground/90">{query}</span>
            <ArrowUpRight className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground/40 transition-colors group-hover:text-primary" />
          </button>
        ))}
      </div>
    </div>
  );
}

export interface ChatInterfaceProps {
  entries: ChatEntry[];
  selectedEntryId: string | null;
  streaming: boolean;
  hasDocuments: boolean;
  seeding: boolean;
  onAsk: (query: string) => void;
  onStop: () => void;
  onSeedDemo: () => void;
  onOpenCitation: (chunkId: string) => void;
  onSelectEntry: (id: string) => void;
  onInspect: () => void;
  onClear: () => void;
  onOpenSources: () => void;
}

export function ChatInterface({
  entries,
  selectedEntryId,
  streaming,
  hasDocuments,
  seeding,
  onAsk,
  onStop,
  onSeedDemo,
  onOpenCitation,
  onSelectEntry,
  onInspect,
  onClear,
  onOpenSources,
}: ChatInterfaceProps) {
  const [value, setValue] = React.useState("");
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const last = entries[entries.length - 1];

  React.useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
    if (distance < 260 || last?.state === "streaming") {
      element.scrollTo({
        top: element.scrollHeight,
        behavior: last?.state === "streaming" ? "auto" : "smooth",
      });
    }
  }, [entries.length, last?.answer, last?.state, last?.stage]);

  React.useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 148)}px`;
  }, [value]);

  const submit = () => {
    const query = value.trim();
    if (!hasDocuments || query.length < 2 || streaming) return;
    setValue("");
    onAsk(query);
  };

  const selectedReport = React.useMemo(() => {
    const entry = entries.find((item) => item.id === selectedEntryId);
    return reportOf(entry);
  }, [entries, selectedEntryId]);

  return (
    <section
      data-tour="chat"
      className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-background"
    >
      <div className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-border px-4">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="text-[12px] font-semibold tracking-[-0.01em] text-foreground">
            Ask Helium
          </h1>
          {streaming ? (
            <Badge tone="info" className="gap-1">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
              </span>
              live analysis
            </Badge>
          ) : (
            <span className="hidden text-[10px] text-muted-foreground sm:inline">
              Grounded in your sources
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {entries.length ? (
            <Button variant="ghost" size="xs" onClick={onClear} className="gap-1">
              <Wand2 className="h-3 w-3" /> Clear
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="xs"
            onClick={onOpenSources}
            className="gap-1 lg:hidden"
          >
            <Layers className="h-3 w-3" /> Sources
          </Button>
          <Button
            variant="secondary"
            size="xs"
            data-tour="report-toggle"
            onClick={onInspect}
            className="gap-1 xl:hidden"
            disabled={!selectedReport}
          >
            <PanelRight className="h-3 w-3" /> Report
          </Button>
        </div>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto scroll-smooth">
        {entries.length === 0 ? (
          <div className="flex min-h-full">
            <EmptyConversation
              hasDocuments={hasDocuments}
              onSeedDemo={onSeedDemo}
              seeding={seeding}
              onAsk={onAsk}
            />
          </div>
        ) : (
          <div className="mx-auto w-full max-w-[780px] space-y-6 px-4 py-5">
            {entries.map((entry) => (
              <div key={entry.id} className="space-y-2">
                <div className="flex flex-col items-end gap-1">
                  <div className="max-w-[86%] rounded-2xl rounded-br-md border border-primary/20 bg-primary/[0.08] px-3.5 py-2 text-[12.5px] leading-relaxed text-foreground shadow-sm">
                    {entry.query}
                  </div>
                  <div className="flex items-center gap-1.5 pr-1 text-[9px] text-muted-foreground">
                    <span>{relativeTime(entry.createdAt)}</span>
                  </div>
                </div>
                <AssistantEntry
                  entry={entry}
                  selected={selectedEntryId === entry.id}
                  onOpenCitation={onOpenCitation}
                  onInspect={() => {
                    onSelectEntry(entry.id);
                    onInspect();
                  }}
                  onRetry={() => onAsk(entry.query)}
                />
              </div>
            ))}
            <div className="h-2" />
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-border bg-background/85 px-4 pb-3 pt-3 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <div className="mx-auto w-full max-w-[780px]">
          <div
            data-tour="ask"
            className={cn(
              "rounded-xl border bg-surface shadow-sm transition-colors",
              streaming
                ? "border-primary/30 ring-1 ring-primary/10"
                : "border-border focus-within:border-primary/40 focus-within:ring-1 focus-within:ring-primary/10",
            )}
          >
            <textarea
              ref={textareaRef}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  submit();
                }
              }}
              rows={1}
              maxLength={800}
              placeholder={
                hasDocuments
                  ? "Ask a policy question…"
                  : "Ask a question or load the demo corpus first…"
              }
              className="max-h-[148px] min-h-[52px] w-full resize-none bg-transparent px-3.5 pb-1 pt-3 text-[12.5px] leading-relaxed text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
            />
            <div className="flex items-center justify-between gap-2 px-2 pb-2">
              <span className="hidden pl-1 text-[9px] text-muted-foreground/60 sm:inline">
                Enter to ask · Shift+Enter for a new line
              </span>
              <div className="ml-auto flex items-center gap-1.5">
                {value.length > 700 ? (
                  <span className="tabular font-mono text-[9.5px] text-muted-foreground">
                    {value.length}/800
                  </span>
                ) : null}
                {streaming ? (
                  <Button variant="secondary" size="sm" onClick={onStop} className="gap-1.5">
                    <Square className="h-3 w-3 fill-current" /> Stop
                  </Button>
                ) : null}
                <Button
                  variant="primary"
                  size="sm"
                  onClick={submit}
                  disabled={!hasDocuments || value.trim().length < 2 || streaming}
                  title={!hasDocuments ? "Load a source or the demo corpus first" : undefined}
                  className="gap-1.5"
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Ask</span>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
