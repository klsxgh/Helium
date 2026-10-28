"use client";

import * as React from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  Database,
  FileText,
  Files,
  History,
  Loader2,
  Plus,
  RotateCw,
  ScanSearch,
  Search,
  Sparkles,
  Square,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";

import type { HealthResponse, HeliumDocument, HistoryItem, RepositoryStats } from "@/lib/api";
import {
  cn,
  fileKind,
  formatDate,
  healthColor,
  pluralize,
  relativeTime,
  truncate,
} from "@/lib/utils";

import { Button, EmptyState, IconButton, ProgressBar, Segmented, Skeleton } from "./ui";

export type SidebarTab = "sources" | "history";

const KIND_STYLE: Record<"pdf" | "docx" | "txt", string> = {
  pdf: "text-rose-500 bg-rose-500/10 border-rose-500/20",
  docx: "text-sky-500 bg-sky-500/10 border-sky-500/20",
  txt: "text-zinc-500 bg-zinc-500/10 border-zinc-500/20",
};

const STATUS_STYLE: Record<string, { label: string; className: string }> = {
  ready: { label: "Indexed", className: "text-emerald-500" },
  processing: { label: "Indexing", className: "text-primary" },
  queued: { label: "Queued", className: "text-amber-500" },
  failed: { label: "Failed", className: "text-rose-500" },
};

function DocumentRow({
  document,
  selected,
  onToggle,
  onDelete,
  onReindex,
}: {
  document: HeliumDocument;
  selected: boolean;
  onToggle: (document: HeliumDocument) => void;
  onDelete: (document: HeliumDocument) => void;
  onReindex: (document: HeliumDocument) => void;
}) {
  const kind = fileKind(document.extension);
  const status = STATUS_STYLE[document.status] ?? {
    label: document.status,
    className: "text-muted-foreground",
  };
  const active = document.status === "processing" || document.status === "queued";
  const selectable = document.status === "ready";

  return (
    <div
      className={cn(
        "group rounded-lg border px-1.5 py-2 transition-colors",
        selected
          ? "border-primary/30 bg-primary/[0.05]"
          : "border-transparent hover:border-border hover:bg-surface-subtle/60",
      )}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          role="checkbox"
          aria-checked={selectable ? selected : false}
          aria-label={
            selectable ? `Select ${document.filename} for scanning` : `${document.filename} is not ready`
          }
          disabled={!selectable}
          onClick={() => onToggle(document)}
          className={cn(
            "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
            selected
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-surface text-transparent",
            selectable ? "hover:border-primary/60" : "cursor-not-allowed opacity-40",
          )}
        >
          {selected ? <Check className="h-3 w-3" /> : <Square className="h-3 w-3 opacity-0" />}
        </button>
        <span
          className={cn(
            "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border",
            KIND_STYLE[kind],
          )}
        >
          <FileText className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-1.5">
            <p
              className="truncate text-[12px] font-medium leading-5 text-foreground"
              title={document.filename}
            >
              {document.filename}
            </p>
            <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
              <IconButton
                label="Re-index document"
                className="h-6 w-6"
                onClick={() => onReindex(document)}
                disabled={active}
              >
                <RotateCw className="h-3 w-3" />
              </IconButton>
              <IconButton
                label="Delete document"
                className="h-6 w-6 hover:bg-rose-500/10 hover:text-rose-500"
                onClick={() => onDelete(document)}
                disabled={active}
              >
                <Trash2 className="h-3 w-3" />
              </IconButton>
            </div>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] text-muted-foreground">
            <span className={cn("font-medium", status.className)}>{status.label}</span>
            <span aria-hidden>·</span>
            <span>{pluralize(document.chunk_count, "chunk")}</span>
            {document.doc_date ? (
              <>
                <span aria-hidden>·</span>
                <span>{formatDate(document.doc_date)}</span>
              </>
            ) : null}
          </div>
          {active ? (
            <div className="mt-1.5 flex items-center gap-2">
              <ProgressBar value={document.progress} className="h-[3px]" />
              <span className="shrink-0 font-mono text-[9px] text-muted-foreground">
                {document.progress}%
              </span>
            </div>
          ) : null}
          {document.status === "failed" && document.error ? (
            <p className="mt-1 line-clamp-2 text-[10px] text-rose-500/90">{document.error}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function HistoryRow({
  item,
  active,
  onOpen,
}: {
  item: HistoryItem;
  active: boolean;
  onOpen: (id: string) => void;
}) {
  const color = healthColor(item.consistency_score);
  return (
    <button
      type="button"
      onClick={() => onOpen(item.id)}
      className={cn(
        "group w-full rounded-lg border px-2.5 py-2 text-left transition-colors",
        active
          ? "border-primary/30 bg-primary/[0.05]"
          : "border-transparent hover:border-border hover:bg-surface-subtle/60",
      )}
    >
      <div className="flex items-start gap-2">
        <span
          className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
        />
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-[11.5px] leading-snug text-foreground">{item.query}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[9.5px] text-muted-foreground">
            <span className="tabular font-mono" style={{ color }}>
              {item.consistency_score}%
            </span>
            <span aria-hidden>·</span>
            <span>{relativeTime(item.created_at)}</span>
            {item.issue_count > 0 ? (
              <>
                <span aria-hidden>·</span>
                <span className="text-rose-500">
                  {item.issue_count} issue{item.issue_count === 1 ? "" : "s"}
                </span>
              </>
            ) : null}
          </div>
        </div>
        <ArrowUpRight className="mt-1 h-3 w-3 shrink-0 text-muted-foreground/40 transition-colors group-hover:text-muted-foreground" />
      </div>
    </button>
  );
}

export interface SidebarProps {
  documents: HeliumDocument[];
  stats: RepositoryStats | null;
  health: HealthResponse | null;
  history: HistoryItem[];
  tab: SidebarTab;
  onTabChange: (tab: SidebarTab) => void;
  uploading: boolean;
  uploadProgress: number;
  onUpload: (files: File[]) => void;
  onDelete: (document: HeliumDocument) => void;
  onReindex: (document: HeliumDocument) => void;
  onScan: (documentIds: string[]) => void;
  scanning: boolean;
  onOpenQuery: (id: string) => void;
  onOpenReview: () => void;
  activeQueryId?: string | null;
  className?: string;
  onCloseMobile?: () => void;
}

export function Sidebar({
  documents,
  stats,
  health,
  history,
  tab,
  onTabChange,
  uploading,
  uploadProgress,
  onUpload,
  onDelete,
  onReindex,
  onScan,
  scanning,
  onOpenQuery,
  onOpenReview,
  activeQueryId,
  className,
  onCloseMobile,
}: SidebarProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = React.useState(false);
  const [filter, setFilter] = React.useState("");
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set());

  const readyIds = React.useMemo(
    () =>
      documents
        .filter((document) => document.status === "ready")
        .map((document) => document.id),
    [documents],
  );

  React.useEffect(() => {
    setSelected((current) => {
      const valid = new Set(readyIds);
      const next = new Set([...current].filter((id) => valid.has(id)));
      const unchanged =
        next.size === current.size && [...next].every((id) => current.has(id));
      return unchanged ? current : next;
    });
  }, [readyIds]);

  const allSelected = readyIds.length > 0 && readyIds.every((id) => selected.has(id));

  const toggleSelected = (document: HeliumDocument) => {
    if (document.status !== "ready") return;
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(document.id)) next.delete(document.id);
      else next.add(document.id);
      return next;
    });
  };

  const filteredDocuments = React.useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return documents;
    return documents.filter((document) => document.filename.toLowerCase().includes(needle));
  }, [documents, filter]);

  const filteredHistory = React.useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return history;
    return history.filter((item) => item.query.toLowerCase().includes(needle));
  }, [history, filter]);

  const handleFiles = (files: FileList | null) => {
    if (!files || !files.length) return;
    onUpload(Array.from(files));
    if (inputRef.current) inputRef.current.value = "";
  };

  const tabs = [
    { value: "sources" as const, label: "Sources", count: documents.length, icon: <Files className="h-3 w-3" /> },
    { value: "history" as const, label: "History", count: history.length, icon: <History className="h-3 w-3" /> },
  ];

  return (
    <aside
      data-tour="sources"
      className={cn(
        "flex h-full min-h-0 w-full flex-col border-r border-border bg-surface/60 lg:w-[292px] lg:shrink-0",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <Database className="h-3.5 w-3.5 text-muted-foreground" />
          <h2 className="micro-label">Source library</h2>
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="xs"
            variant="ghost"
            className="gap-1"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
          >
            <Plus className="h-3 w-3" /> Add
          </Button>
          {onCloseMobile ? (
            <IconButton label="Close sources" className="lg:hidden" onClick={onCloseMobile}>
              <X className="h-4 w-4" />
            </IconButton>
          ) : null}
        </div>
      </div>

      <div data-tour="sidebar-tabs" className="px-3 pb-2.5 pt-2.5">
        <Segmented
          options={tabs}
          value={tab}
          onChange={(value) => onTabChange(value)}
          className="w-full [&>button]:flex-1"
        />
      </div>

      <div className="px-3 pb-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder={tab === "sources" ? "Filter sources…" : "Search questions…"}
            className="h-7 w-full rounded-md border border-input bg-surface pl-7 pr-6 text-[11px] text-foreground placeholder:text-muted-foreground/60 focus:border-primary/40 focus:outline-none"
          />
          {filter ? (
            <button
              type="button"
              onClick={() => setFilter("")}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Clear filter"
            >
              <X className="h-3 w-3" />
            </button>
          ) : null}
        </div>
      </div>

      {tab === "sources" && readyIds.length >= 2 ? (
        <div className="flex items-center gap-1.5 border-b border-border/60 px-3 pb-2">
          <button
            type="button"
            onClick={() =>
              setSelected(allSelected ? new Set() : new Set(readyIds))
            }
            className="shrink-0 text-[9.5px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            {allSelected ? "Clear" : "Select all"}
          </button>
          <span className="min-w-0 flex-1 truncate text-[9.5px] text-muted-foreground">
            {selected.size
              ? `${selected.size} of ${readyIds.length} selected`
              : "Select files to compare"}
          </span>
          <Button
            size="xs"
            variant={selected.size >= 2 ? "primary" : "secondary"}
            disabled={selected.size < 2 || scanning}
            onClick={() => onScan([...selected])}
            className="gap-1"
          >
            {scanning ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <ScanSearch className="h-3 w-3" />
            )}
            Scan
          </Button>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {tab === "sources" ? (
          <>
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,.docx,.txt"
              multiple
              className="hidden"
              onChange={(event) => handleFiles(event.target.files)}
            />
            <div
              data-tour="upload"
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                handleFiles(event.dataTransfer.files);
              }}
              className={cn(
                "mx-1 mb-2 rounded-lg border border-dashed px-3 py-2.5 text-center transition-colors",
                dragging
                  ? "border-primary/60 bg-primary/[0.06]"
                  : "border-border bg-surface-subtle/30 hover:border-foreground/20",
              )}
            >
              {uploading ? (
                <div>
                  <div className="mb-1.5 flex items-center justify-center gap-1.5 text-[11px] font-medium text-foreground">
                    <Loader2 className="h-3 w-3 animate-spin text-primary" />
                    Uploading {uploadProgress}%
                  </div>
                  <ProgressBar value={uploadProgress} className="h-1" />
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  className="flex w-full items-center justify-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground"
                >
                  <UploadCloud className="h-3.5 w-3.5" />
                  Drop PDF, DOCX, or TXT
                  <span className="text-muted-foreground/50">·</span>
                  <span className="text-primary">browse</span>
                </button>
              )}
            </div>

            {documents.length === 0 ? (
              <EmptyState
                icon={<Sparkles className="h-4 w-4" />}
                title="No sources yet"
                description="Drop a policy above, or load the demo corpus from the workspace to see contradiction analysis in action."
                className="mx-1 border-border/70 py-7"
              />
            ) : filteredDocuments.length === 0 ? (
              <p className="px-2 py-6 text-center text-[11px] text-muted-foreground">
                No documents match “{filter}”.
              </p>
            ) : (
              <div className="space-y-0.5">
                {filteredDocuments.map((document) => (
                  <DocumentRow
                    key={document.id}
                    document={document}
                    selected={selected.has(document.id)}
                    onToggle={toggleSelected}
                    onDelete={onDelete}
                    onReindex={onReindex}
                  />
                ))}
              </div>
            )}
          </>
        ) : null}

        {tab === "history" ? (
          filteredHistory.length === 0 ? (
            <EmptyState
              icon={<History className="h-4 w-4" />}
              title={history.length ? "No matching questions" : "No history yet"}
              description={
                history.length
                  ? "Try a different search term."
                  : "Questions you ask are saved with their full consistency report so you can reopen them."
              }
              className="mx-1 border-border/70 py-7"
            />
          ) : (
            <div className="space-y-0.5">
              {filteredHistory.map((item) => (
                <HistoryRow
                  key={item.id}
                  item={item}
                  active={activeQueryId === item.id}
                  onOpen={onOpenQuery}
                />
              ))}
            </div>
          )
        ) : null}
      </div>

      <div className="border-t border-border px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <p className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground">
            {health
              ? `${pluralize(stats?.documents_ready ?? 0, "source")} · ${pluralize(
                  stats?.chunks ?? 0,
                  "chunk",
                )}`
              : "Check that the backend is running"}
          </p>
          <IconButton label="Review queue" onClick={onOpenReview} className="h-7 w-7">
            <span className="relative">
              <AlertTriangle className="h-3.5 w-3.5" />
              {stats && stats.open_conflicts > 0 ? (
                <span className="absolute -right-1.5 -top-1.5 flex h-3 min-w-3 items-center justify-center rounded-full bg-rose-500 px-0.5 text-[8px] font-bold text-white">
                  {stats.open_conflicts > 9 ? "9+" : stats.open_conflicts}
                </span>
              ) : null}
            </span>
          </IconButton>
        </div>
      </div>
    </aside>
  );
}

export function SidebarSkeleton() {
  return (
    <div className="space-y-2 p-3">
      {Array.from({ length: 5 }).map((_, index) => (
        <div key={index} className="flex items-center gap-2">
          <Skeleton className="h-7 w-7 rounded-md" />
          <div className="flex-1 space-y-1">
            <Skeleton className="h-2.5 w-3/4" />
            <Skeleton className="h-2 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function healthSummary(health: HealthResponse | null): string {
  if (!health) return "Offline";
  return `${health.stats.documents_ready} ready · ${health.stats.chunks} chunks`;
}

export function documentLabel(filename: string): string {
  return truncate(filename, 48);
}
