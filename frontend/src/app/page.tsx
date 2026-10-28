"use client";

import * as React from "react";
import { CircleAlert, RefreshCw, WifiOff } from "lucide-react";

import { AppHeader, type MobilePane } from "@/components/AppHeader";
import { ChatInterface } from "@/components/ChatInterface";
import { CitationModal, type CitationTarget } from "@/components/CitationModal";
import { ConfirmDialog, type ConfirmState } from "@/components/ConfirmDialog";
import { Inspector, type InspectorTab } from "@/components/Inspector";
import { ProductTour } from "@/components/ProductTour";
import { ReviewDrawer } from "@/components/ReviewDrawer";
import { ScanDrawer } from "@/components/ScanDrawer";
import { SettingsModal } from "@/components/SettingsModal";
import { Sidebar, type SidebarTab } from "@/components/Sidebar";
import { Toasts, type ToastItem, type ToastTone } from "@/components/Toasts";
import { Button } from "@/components/ui";
import {
  api,
  streamQuery,
  uploadDocuments,
  type Claim,
  type Conflict,
  type HealthResponse,
  type HeliumDocument,
  type HistoryItem,
  type RepositoryStats,
  type ReviewAction,
  type ScanResult,
} from "@/lib/api";
import { reportOf, type AnalysisSnapshot, type ChatEntry } from "@/lib/chat";
import { cn } from "@/lib/utils";

const THEME_KEY = "helium-theme";
const REVIEWER_KEY = "helium-reviewer";
const TOPK_KEY = "helium-topk";
const TOUR_KEY = "helium-tour-completed-v1";
const DEFAULT_REVIEWER = "Compliance Reviewer";
const ACCEPTED = new Set([".pdf", ".docx", ".txt"]);
const MAX_FILES = 50;
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const ISSUE_RELATIONSHIPS = new Set(["contradiction", "conditional_conflict", "ambiguity"]);

function reportFromResult(result: {
  query_id: string;
  metrics: AnalysisSnapshot["metrics"];
  consistency_score: number;
  chunks_analyzed: number;
  conflicts: Conflict[];
  citations: AnalysisSnapshot["citations"];
  claims: Claim[];
  relationships: Conflict[];
}): AnalysisSnapshot {
  return {
    query_id: result.query_id,
    metrics: result.metrics,
    consistency_score: result.consistency_score,
    chunks_analyzed: result.chunks_analyzed,
    conflicts: result.conflicts,
    citations: result.citations,
    claims: result.claims,
    relationships: result.relationships,
  };
}

function applyConflict(snapshot: AnalysisSnapshot, updated: Conflict): AnalysisSnapshot {
  const relationships = snapshot.relationships.map((item) =>
    item.id === updated.id ? updated : item,
  );
  return {
    ...snapshot,
    relationships,
    conflicts: relationships.filter((item) => ISSUE_RELATIONSHIPS.has(item.relationship)),
  };
}

export default function HeliumPage() {
  const [theme, setTheme] = React.useState<"light" | "dark" | null>(null);
  const [documents, setDocuments] = React.useState<HeliumDocument[]>([]);
  const [stats, setStats] = React.useState<RepositoryStats | null>(null);
  const [health, setHealth] = React.useState<HealthResponse | null>(null);
  const [history, setHistory] = React.useState<HistoryItem[]>([]);
  const [backendError, setBackendError] = React.useState<string | null>(null);
  const [entries, setEntries] = React.useState<ChatEntry[]>([]);
  const [selectedEntryId, setSelectedEntryId] = React.useState<string | null>(null);
  const [streaming, setStreaming] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [uploadProgress, setUploadProgress] = React.useState(0);
  const [seeding, setSeeding] = React.useState(false);
  const [sidebarTab, setSidebarTab] = React.useState<SidebarTab>("sources");
  const [inspectorTab, setInspectorTab] = React.useState<InspectorTab>("consistency");
  const [pane, setPane] = React.useState<MobilePane>("chat");
  const [reviewOpen, setReviewOpen] = React.useState(false);
  const [scanOpen, setScanOpen] = React.useState(false);
  const [scanLoading, setScanLoading] = React.useState(false);
  const [scanResult, setScanResult] = React.useState<ScanResult | null>(null);
  const [scanError, setScanError] = React.useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [tourOpen, setTourOpen] = React.useState(false);
  const [citation, setCitation] = React.useState<CitationTarget | null>(null);
  const [toasts, setToasts] = React.useState<ToastItem[]>([]);
  const [confirm, setConfirm] = React.useState<ConfirmState | null>(null);
  const [topK, setTopK] = React.useState(8);
  const [reviewer, setReviewer] = React.useState(DEFAULT_REVIEWER);

  const abortRef = React.useRef<AbortController | null>(null);
  const timersRef = React.useRef<Map<string, number>>(new Map());

  const notify = React.useCallback((message: string, tone: ToastTone = "info") => {
    const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    setToasts((current) => [...current.slice(-3), { id, message, tone }]);
    const timer = window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
      timersRef.current.delete(id);
    }, 4600);
    timersRef.current.set(id, timer);
  }, []);

  const dismissToast = React.useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer) window.clearTimeout(timer);
    timersRef.current.delete(id);
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);

  const refreshRepository = React.useCallback(async () => {
    try {
      const [documentList, status] = await Promise.all([api.listDocuments(), api.health()]);
      setDocuments(documentList.documents);
      setStats(documentList.stats);
      setHealth(status);
      setBackendError(null);
    } catch (err) {
      setBackendError(err instanceof Error ? err.message : "The Helium API is unreachable.");
      setHealth(null);
    }
  }, []);

  const refreshHistory = React.useCallback(async () => {
    try {
      setHistory(await api.history());
    } catch {
      /* The repository banner already communicates connectivity problems. */
    }
  }, []);

  const selectedReport = React.useMemo(() => {
    const entry = entries.find((item) => item.id === selectedEntryId);
    return reportOf(entry);
  }, [entries, selectedEntryId]);

  const selectedEntry = React.useMemo(
    () => entries.find((item) => item.id === selectedEntryId) ?? null,
    [entries, selectedEntryId],
  );

  const activeDocuments = React.useMemo(
    () => documents.some((document) => document.status === "processing" || document.status === "queued"),
    [documents],
  );

  React.useEffect(() => {
    try {
      const storedTheme = window.localStorage.getItem(THEME_KEY);
      setTheme(
        storedTheme === "light" || storedTheme === "dark"
          ? storedTheme
          : document.documentElement.classList.contains("dark")
            ? "dark"
            : "light",
      );
      const storedTopK = Number(window.localStorage.getItem(TOPK_KEY));
      if ([4, 6, 8, 12].includes(storedTopK)) setTopK(storedTopK);
      const storedReviewer = window.localStorage.getItem(REVIEWER_KEY);
      if (storedReviewer?.trim()) setReviewer(storedReviewer.slice(0, 120));
    } catch {
      setTheme("dark");
    }
    void refreshRepository();
    void refreshHistory();
  }, [refreshRepository, refreshHistory]);

  React.useEffect(() => {
    let completed = false;
    try {
      completed = window.localStorage.getItem(TOUR_KEY) === "1";
    } catch {
      /* Storage may be blocked; show the tour in that case. */
    }
    if (completed) return;
    const timer = window.setTimeout(() => setTourOpen(true), 1100);
    return () => window.clearTimeout(timer);
  }, []);

  React.useEffect(() => {
    if (!theme) return;
    document.documentElement.classList.toggle("dark", theme === "dark");
    try {
      window.localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* Storage can be blocked; the theme still applies for this session. */
    }
  }, [theme]);

  React.useEffect(() => {
    try {
      window.localStorage.setItem(TOPK_KEY, String(topK));
    } catch {
      /* ignore */
    }
  }, [topK]);

  React.useEffect(() => {
    try {
      window.localStorage.setItem(REVIEWER_KEY, reviewer);
    } catch {
      /* ignore */
    }
  }, [reviewer]);

  React.useEffect(() => {
    const interval = window.setInterval(
      () => void refreshRepository(),
      activeDocuments ? 3500 : 25000,
    );
    return () => window.clearInterval(interval);
  }, [activeDocuments, refreshRepository]);

  React.useEffect(() => {
    return () => {
      abortRef.current?.abort();
      timersRef.current.forEach((timer) => window.clearTimeout(timer));
      timersRef.current.clear();
    };
  }, []);

  const patchEntry = React.useCallback(
    (id: string, updater: (entry: ChatEntry) => ChatEntry) => {
      setEntries((current) => current.map((entry) => (entry.id === id ? updater(entry) : entry)));
    },
    [],
  );

  const ask = React.useCallback(
    async (rawQuery: string) => {
      const query = rawQuery.trim().replace(/\s+/g, " ");
      if (query.length < 2 || abortRef.current) return;

      const id = `live_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const started = performance.now();
      const controller = new AbortController();
      abortRef.current = controller;

      const entry: ChatEntry = {
        id,
        query,
        topK,
        state: "streaming",
        stage: "retrieving",
        statusText: "Embedding the question and searching the FAISS index…",
        answer: "",
        createdAt: new Date().toISOString(),
      };

      setEntries((current) => [...current, entry]);
      setSelectedEntryId(id);
      setInspectorTab("consistency");
      setStreaming(true);
      setPane("chat");

      try {
        await streamQuery(
          query,
          topK,
          {
            onStatus: (status) => {
              patchEntry(id, (item) => ({
                ...item,
                stage: status.stage,
                statusText: status.message,
              }));
            },
            onAnalysis: (analysis) => {
              patchEntry(id, (item) => ({
                ...item,
                analysis: reportFromResult(analysis),
                stage: "generating",
                statusText: "Claims compared. Writing a grounded answer…",
              }));
            },
            onDelta: (text) => {
              patchEntry(id, (item) => ({
                ...item,
                answer: item.answer + text,
                stage: "generating",
                statusText: "Streaming grounded response…",
              }));
            },
            onComplete: (result) => {
              patchEntry(id, (item) => ({
                ...item,
                state: "complete",
                statusText: "Analysis complete",
                stage: "complete",
                answer: result.answer,
                result,
                analysis: reportFromResult(result),
                elapsedMs: performance.now() - started,
              }));
            },
          },
          controller.signal,
        );
        void refreshHistory();
        void refreshRepository();
      } catch (err) {
        if (controller.signal.aborted) {
          patchEntry(id, (item) => ({
            ...item,
            state: "stopped",
            statusText: "Stopped by reviewer",
            error: "Generation was stopped before completion.",
          }));
          notify("Response stopped. Any partial analysis is preserved.", "info");
        } else {
          const message =
            err instanceof Error ? err.message : "The query could not be completed.";
          patchEntry(id, (item) => ({
            ...item,
            state: "error",
            statusText: "Failed",
            error: message,
          }));
          notify(message, "error");
        }
      } finally {
        abortRef.current = null;
        setStreaming(false);
      }
    },
    [notify, patchEntry, refreshHistory, refreshRepository, topK],
  );

  const stop = React.useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const seedDemo = React.useCallback(async () => {
    if (seeding) return;
    setSeeding(true);
    try {
      const result = await api.seedDemo();
      notify(result.message, "success");
      await refreshRepository();
    } catch (err) {
      notify(err instanceof Error ? err.message : "The demo corpus could not be loaded.", "error");
    } finally {
      setSeeding(false);
    }
  }, [notify, refreshRepository, seeding]);

  const uploadFiles = React.useCallback(
    async (files: File[]) => {
      if (uploading || !files.length) return;
      const valid: File[] = [];
      let rejected = 0;
      for (const file of files) {
        const dot = file.name.lastIndexOf(".");
        const extension = dot >= 0 ? file.name.slice(dot).toLowerCase() : "";
        if (!ACCEPTED.has(extension) || file.size === 0 || file.size > MAX_FILE_BYTES) {
          rejected += 1;
          continue;
        }
        valid.push(file);
      }
      if (!valid.length) {
        notify("Only non-empty PDF, DOCX, or TXT files up to 50 MB are supported.", "error");
        return;
      }
      if (valid.length > MAX_FILES) {
        notify(`A maximum of ${MAX_FILES} files can be uploaded at once.`, "error");
        return;
      }

      setUploading(true);
      setUploadProgress(0);
      try {
        const result = await uploadDocuments(valid, setUploadProgress);
        notify(
          rejected
            ? `${result.message} ${rejected} file(s) were rejected locally.`
            : result.message,
          result.duplicate ? "info" : "success",
        );
        setSidebarTab("sources");
        if (window.matchMedia("(max-width: 1023px)").matches) setPane("sources");
        await refreshRepository();
      } catch (err) {
        notify(err instanceof Error ? err.message : "The upload failed.", "error");
      } finally {
        setUploading(false);
        window.setTimeout(() => setUploadProgress(0), 800);
      }
    },
    [notify, refreshRepository, uploading],
  );

  const reindexDocument = React.useCallback(
    async (document: HeliumDocument) => {
      try {
        await api.reindexDocument(document.id);
        notify(`${document.filename} was re-indexed.`, "success");
        await refreshRepository();
      } catch (err) {
        notify(err instanceof Error ? err.message : "Re-indexing failed.", "error");
      }
    },
    [notify, refreshRepository],
  );

  const deleteDocument = React.useCallback(
    (document: HeliumDocument) => {
      setConfirm({
        title: `Delete “${document.filename}”?`,
        description:
          "The document, its chunks, claims, and vector entries will be removed. Past query reports are retained.",
        confirmLabel: "Delete document",
        tone: "danger",
        onConfirm: async () => {
          try {
            await api.deleteDocument(document.id);
            notify(`${document.filename} was deleted and the index rebuilt.`, "success");
            await refreshRepository();
            void refreshHistory();
          } catch (err) {
            notify(err instanceof Error ? err.message : "The document could not be deleted.", "error");
          }
        },
      });
    },
    [notify, refreshHistory, refreshRepository],
  );

  const openHistory = React.useCallback(
    async (queryId: string) => {
      const existing = entries.find((entry) => entry.result?.query_id === queryId);
      if (existing) {
        setSelectedEntryId(existing.id);
        setInspectorTab("consistency");
        setPane("chat");
        return;
      }
      try {
        const result = await api.historyDetail(queryId);
        const id = `history_${queryId}`;
        const restored: ChatEntry = {
          id,
          query: result.query,
          topK: result.metrics?.top_k ?? topK,
          state: "complete",
          stage: "complete",
          statusText: "Restored from history",
          answer: result.answer,
          result,
          analysis: reportFromResult(result),
          createdAt: result.created_at,
          elapsedMs: result.metrics?.total_ms,
        };
        setEntries((current) => [...current, restored]);
        setSelectedEntryId(id);
        setInspectorTab("consistency");
        setPane("chat");
      } catch (err) {
        notify(err instanceof Error ? err.message : "The query report could not be opened.", "error");
      }
    },
    [entries, notify, topK],
  );

  const decide = React.useCallback(
    async (conflict: Conflict, action: ReviewAction, note?: string) => {
      try {
        const updated = await api.resolveConflict(conflict.id, {
          action,
          reviewer: reviewer.trim() || DEFAULT_REVIEWER,
          note,
        });
        setEntries((current) =>
          current.map((entry) => {
            const touchesReport =
              entry.analysis?.relationships.some((item) => item.id === updated.id) ||
              entry.result?.relationships.some((item) => item.id === updated.id);
            if (!touchesReport) return entry;
            const next = { ...entry };
            if (entry.analysis) next.analysis = applyConflict(entry.analysis, updated);
            if (entry.result) {
              const base = reportFromResult(entry.result);
              const patched = applyConflict(base, updated);
              next.result = {
                ...entry.result,
                relationships: patched.relationships,
                conflicts: patched.conflicts,
              };
            }
            return next;
          }),
        );
        notify(
          `${action === "reopen" ? "Conflict reopened" : "Reviewer decision recorded"}.`,
          "success",
        );
        await refreshRepository();
        void refreshHistory();
        return updated;
      } catch (err) {
        const message = err instanceof Error ? err.message : "The decision could not be recorded.";
        notify(message, "error");
        throw err;
      }
    },
    [notify, refreshHistory, refreshRepository, reviewer],
  );

  const openCitation = React.useCallback(
    (chunkId: string) => {
      const citationMatch = selectedReport?.citations.find((item) => item.chunk_id === chunkId);
      setCitation({
        chunkId,
        label: citationMatch?.label,
        quote: citationMatch?.quote,
      });
    },
    [selectedReport],
  );

  const openInspector = React.useCallback((tab: InspectorTab = "consistency") => {
    setInspectorTab(tab);
    if (window.matchMedia("(max-width: 1279px)").matches) setPane("report");
  }, []);

  const openSources = React.useCallback(() => {
    setSidebarTab("sources");
    if (window.matchMedia("(max-width: 1023px)").matches) setPane("sources");
  }, []);

  const runScan = React.useCallback(
    async (documentIds: string[]) => {
      if (documentIds.length < 2) return;
      setScanOpen(true);
      setScanLoading(true);
      setScanError(null);
      setScanResult(null);
      try {
        const result = await api.scan(documentIds);
        setScanResult(result);
        notify(
          `Scan complete: ${result.conflicts.length} issue${
            result.conflicts.length === 1 ? "" : "s"
          } found.`,
          result.conflicts.length ? "info" : "success",
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : "The scan could not be completed.";
        setScanError(message);
        notify(message, "error");
      } finally {
        setScanLoading(false);
      }
    },
    [notify],
  );

  const decideScan = React.useCallback(
    async (conflict: Conflict, action: ReviewAction, note?: string) => {
      const updated = await decide(conflict, action, note);
      setScanResult((current) => {
        if (!current) return current;
        const relationships = current.relationships.map((item) =>
          item.id === updated.id ? updated : item,
        );
        return {
          ...current,
          relationships,
          conflicts: relationships.filter((item) => ISSUE_RELATIONSHIPS.has(item.relationship)),
        };
      });
      return updated;
    },
    [decide],
  );

  const openReview = React.useCallback(() => {
    setReviewOpen(true);
  }, []);

  const resetWorkspace = React.useCallback(async () => {
    await api.resetWorkspace();
    setEntries([]);
    setSelectedEntryId(null);
    setScanResult(null);
    setScanOpen(false);
    setReviewOpen(false);
    await refreshRepository();
    await refreshHistory();
    notify("Workspace cleared. You can start fresh.", "success");
  }, [notify, refreshRepository, refreshHistory]);

  const openSettings = React.useCallback(() => {
    setReviewOpen(false);
    setSettingsOpen(true);
  }, []);

  const closeSettings = React.useCallback(() => setSettingsOpen(false), []);

  const finishTour = React.useCallback(() => {
    setTourOpen(false);
    setPane("chat");
    try {
      window.localStorage.setItem(TOUR_KEY, "1");
    } catch {
      /* The tour can reappear if storage is blocked. */
    }
  }, []);

  const startTour = React.useCallback(() => {
    setSettingsOpen(false);
    setReviewOpen(false);
    setCitation(null);
    setTourOpen(true);
  }, []);

  const clearConversation = React.useCallback(() => {
    if (!entries.length) return;
    setConfirm({
      title: "Clear this conversation?",
      description:
        "The visible chat will be cleared. Every report remains available in query history.",
      confirmLabel: "Clear conversation",
      onConfirm: () => {
        setEntries([]);
        setSelectedEntryId(null);
        setPane("chat");
        notify("Conversation cleared. Reports are still available in history.", "info");
      },
    });
  }, [entries.length, notify]);

  const closeCitation = React.useCallback(() => setCitation(null), []);
  const closeReview = React.useCallback(() => setReviewOpen(false), []);
  const closeConfirm = React.useCallback(() => setConfirm(null), []);

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openSources();
        window.setTimeout(() => {
          const input = document.querySelector<HTMLInputElement>(
            'input[placeholder="Filter sources…"], input[placeholder="Search questions…"]',
          );
          input?.focus();
        }, 60);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openSources]);

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-background">
      <AppHeader
        stats={stats}
        pane={pane}
        onPaneChange={setPane}
        onOpenReview={openReview}
        onOpenSettings={openSettings}
      />

      {backendError ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-amber-500/25 bg-amber-500/[0.07] px-3 py-1.5">
          <WifiOff className="h-3.5 w-3.5 shrink-0 text-amber-500" />
          <p className="min-w-0 flex-1 truncate text-[10.5px] text-amber-600 dark:text-amber-400">
            Helium API is unreachable. Start the backend, then retry.
            <span className="ml-1 hidden font-mono text-[9px] opacity-70 sm:inline">
              uvicorn app.main:app --reload
            </span>
          </p>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => void refreshRepository()}
            className="gap-1 text-amber-600 hover:text-amber-500 dark:text-amber-400"
          >
            <RefreshCw className="h-3 w-3" /> Retry
          </Button>
        </div>
      ) : null}

      <main className="flex min-h-0 flex-1">
        <Sidebar
          documents={documents}
          stats={stats}
          health={health}
          history={history}
          tab={sidebarTab}
          onTabChange={setSidebarTab}
          uploading={uploading}
          uploadProgress={uploadProgress}
          onUpload={uploadFiles}
          onDelete={deleteDocument}
          onReindex={reindexDocument}
          onOpenQuery={openHistory}
          onOpenReview={openReview}
          onScan={runScan}
          scanning={scanLoading}
          activeQueryId={selectedEntry?.result?.query_id ?? null}
          className={cn(pane === "sources" ? "flex" : "hidden", "lg:flex")}
          onCloseMobile={() => setPane("chat")}
        />

        <div
          className={cn(
            "min-h-0 min-w-0 flex-1",
            pane === "chat" ? "flex" : "hidden",
            "lg:flex",
          )}
        >
          <ChatInterface
            entries={entries}
            selectedEntryId={selectedEntryId}
            streaming={streaming}
            hasDocuments={documents.length > 0}
            seeding={seeding}
            onAsk={ask}
            onStop={stop}
            onSeedDemo={seedDemo}
            onOpenCitation={openCitation}
            onSelectEntry={setSelectedEntryId}
            onInspect={() => openInspector("consistency")}
            onClear={clearConversation}
            onOpenSources={openSources}
          />
        </div>

        <Inspector
          entry={selectedEntry}
          report={selectedReport}
          streaming={selectedEntry?.state === "streaming"}
          tab={inspectorTab}
          onTabChange={setInspectorTab}
          onOpenCitation={openCitation}
          onDecide={decide}
          onOpenReview={openReview}
          className={cn(
            pane === "report"
              ? "fixed inset-0 z-40 flex w-full bg-background xl:static xl:z-auto"
              : "hidden xl:flex",
          )}
          onCloseMobile={() => setPane("chat")}
        />
      </main>

      <CitationModal target={citation} onClose={closeCitation} />

      <ScanDrawer
        open={scanOpen}
        loading={scanLoading}
        result={scanResult}
        error={scanError}
        onClose={() => setScanOpen(false)}
        onDecide={decideScan}
        onOpenCitation={openCitation}
        onOpenReview={() => {
          setScanOpen(false);
          setReviewOpen(true);
        }}
      />

      <ReviewDrawer
        open={reviewOpen}
        onClose={closeReview}
        reviewer={reviewer}
        onReviewerChange={setReviewer}
        onDecide={decide}
        onOpenCitation={openCitation}
        onChanged={() => {
          void refreshRepository();
          void refreshHistory();
        }}
        notify={notify}
      />

      <SettingsModal
        open={settingsOpen}
        onClose={closeSettings}
        theme={theme ?? "dark"}
        onThemeChange={setTheme}
        topK={topK}
        onTopKChange={setTopK}
        reviewer={reviewer}
        onReviewerChange={setReviewer}
        health={health}
        backendError={backendError}
        hasDocuments={documents.length > 0}
        seeding={seeding}
        onSeedDemo={seedDemo}
        onReplayTour={startTour}
        onResetWorkspace={resetWorkspace}
      />

      <ProductTour
        open={tourOpen}
        hasDocuments={documents.length > 0}
        onRequestPane={setPane}
        onFinish={finishTour}
      />

      <ConfirmDialog state={confirm} onClose={closeConfirm} />

      <Toasts toasts={toasts} onDismiss={dismissToast} />

      {health === null && !backendError ? (
        <div className="pointer-events-none fixed bottom-3 left-3 z-40 flex items-center gap-1.5 rounded-full border border-border bg-surface px-2 py-1 text-[9px] text-muted-foreground shadow-sm">
          <CircleAlert className="h-3 w-3" /> Connecting to Helium…
        </div>
      ) : null}
    </div>
  );
}
