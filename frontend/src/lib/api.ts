export type RelationshipType =
  | "agreement"
  | "contradiction"
  | "conditional_conflict"
  | "equivalence"
  | "ambiguity";

export type Severity = "critical" | "high" | "medium" | "low" | "info";

export interface HeliumDocument {
  id: string;
  filename: string;
  content_type: string;
  extension: string;
  size_bytes: number;
  version: number;
  status: "queued" | "processing" | "ready" | "failed" | string;
  stage: string;
  progress: number;
  error: string | null;
  chunk_count: number;
  page_count: number;
  doc_date: string | null;
  uploaded_at: string;
  processed_at: string | null;
}

export interface RepositoryStats {
  documents: number;
  documents_ready: number;
  documents_processing: number;
  chunks: number;
  queries: number;
  open_conflicts: number;
  flagged_conflicts: number;
  resolved_conflicts: number;
  contradictions: number;
}

export interface EmbeddingStatus {
  backend: string;
  model: string;
  dimension?: number;
  fallback_reason?: string | null;
}

export interface IndexStatus {
  status: string;
  vectors: number;
  dimension: number;
  index_type: string;
  embedding: EmbeddingStatus;
  persisted: boolean;
  path: string;
}

export interface HealthResponse {
  status: string;
  app: string;
  version: string;
  index: IndexStatus;
  stats: RepositoryStats;
  capabilities: Record<string, unknown>;
}

export interface Claim {
  claim_id: string;
  chunk_id: string;
  document_id: string;
  entity: string;
  subject?: string;
  action: string;
  object: string;
  modality: "must" | "should" | "may" | "prohibited" | "informational" | string;
  negation: boolean;
  numeric_constraints: string[];
  conditions: string[];
  raw_text: string;
  confidence: number;
  source_filename: string;
  page_number: number;
  section_heading: string | null;
  doc_date: string | null;
  uploaded_at: string | null;
  version: number;
}

export interface Mismatch {
  field: string;
  detail: string;
  claim_a?: unknown;
  claim_b?: unknown;
}

export interface Conflict {
  id: string;
  query_id?: string;
  relationship: RelationshipType;
  severity: Severity;
  confidence: number;
  explanation: string;
  mismatches: Mismatch[];
  claim_a: Claim;
  claim_b: Claim;
  status: "open" | "flagged" | "resolved" | string;
  resolution: string | null;
  active_claim_id: string | null;
  resolved_by: string | null;
  resolution_note: string | null;
  resolved_at: string | null;
  created_at: string;
  query_text?: string | null;
}

export interface Citation {
  label: string;
  chunk_id: string;
  filename: string;
  page_number: number;
  section_heading: string | null;
  quote: string;
  score: number;
}

export interface QueryMetrics {
  retrieval_ms: number;
  analysis_ms: number;
  generation_ms: number;
  total_ms: number;
  top_k: number;
  retrieved_chunks: number;
  claims_analyzed: number;
  pairs_analyzed: number;
  embedding_backend: string;
  embedding_model: string;
  index_type: string;
  generation_backend: string;
  relationship_counts?: Record<string, number>;
}

export interface QueryResult {
  query_id: string;
  query: string;
  answer: string;
  citations: Citation[];
  claims: Claim[];
  relationships: Conflict[];
  conflicts: Conflict[];
  metrics: QueryMetrics;
  consistency_score: number;
  chunks_analyzed: number;
  created_at: string;
}

export interface ScanResult {
  scan_id: string;
  query: string;
  document_ids: string[];
  document_names: string[];
  relationships: Conflict[];
  conflicts: Conflict[];
  counts: Record<string, number>;
  claims_analyzed: number;
  pairs_analyzed: number;
  chunks_analyzed: number;
  consistency_score: number;
  created_at: string;
  metrics: Record<string, unknown>;
}

export interface HistoryItem {
  id: string;
  query: string;
  consistency_score: number;
  chunks_analyzed: number;
  issue_count: number;
  contradiction_count: number;
  pair_count: number;
  created_at: string;
}

export interface UploadResult {
  documents: HeliumDocument[];
  duplicate: boolean;
  message: string;
}

export interface SeedResult {
  documents: HeliumDocument[];
  message: string;
}

export interface ChunkDetail {
  id: string;
  document_id: string;
  chunk_index: number;
  page_number: number;
  section_heading: string | null;
  text: string;
  token_count: number;
  filename: string;
  doc_date: string | null;
  uploaded_at: string;
  version: number;
}

export type ReviewAction =
  | "accept_newest"
  | "keep_current"
  | "flag_review"
  | "mark_false_positive"
  | "reopen";

export class ApiError extends Error {
  status: number;
  detail: unknown;

  constructor(message: string, status = 0, detail?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

export const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "/api").replace(/\/$/, "");

function errorMessage(detail: unknown, fallback: string): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && "msg" in item) return String(item.msg);
        return JSON.stringify(item);
      })
      .join("; ");
  }
  if (detail && typeof detail === "object" && "detail" in detail) {
    return errorMessage((detail as { detail: unknown }).detail, fallback);
  }
  return fallback;
}

let authTokenGetter: (() => Promise<string | null>) | null = null;

export function setAuthTokenGetter(getter: (() => Promise<string | null>) | null) {
  authTokenGetter = getter;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  if (authTokenGetter) {
    try {
      const token = await authTokenGetter();
      if (token) headers.set("Authorization", `Bearer ${token}`);
    } catch {
      /* ignore */
    }
  }
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });
  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!response.ok) {
    const detail =
      body && typeof body === "object" && "detail" in body
        ? (body as { detail: unknown }).detail
        : body;
    throw new ApiError(
      errorMessage(detail, `Request failed with status ${response.status}`),
      response.status,
      detail,
    );
  }
  return body as T;
}

export const api = {
  health: () => request<HealthResponse>("/health"),
  listDocuments: () =>
    request<{ documents: HeliumDocument[]; stats: RepositoryStats }>("/documents"),
  deleteDocument: (id: string) =>
    request<{ deleted: boolean }>(`/documents/${id}`, { method: "DELETE" }),
  reindexDocument: (id: string) =>
    request<HeliumDocument>(`/documents/${id}/reindex`, { method: "POST" }),
  seedDemo: () => request<SeedResult>("/demo/seed", { method: "POST" }),
  citation: (chunkId: string) => request<ChunkDetail>(`/chunks/${chunkId}`),
  history: () => request<HistoryItem[]>("/history"),
  historyDetail: (queryId: string) => request<QueryResult>(`/history/${queryId}`),
  scan: (documentIds: string[]) =>
    request<ScanResult>("/scan", {
      method: "POST",
      body: JSON.stringify({ document_ids: documentIds }),
    }),
  scanDetail: (scanId: string) => request<ScanResult>(`/scan/${scanId}`),
  reviewConflicts: (status = "flagged") =>
    request<Conflict[]>(`/admin/conflicts?status=${status}&limit=200`),
  resolveConflict: (
    conflictId: string,
    body: { action: ReviewAction; reviewer: string; note?: string },
  ) =>
    request<Conflict>(`/admin/conflicts/${conflictId}/resolve`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  resetWorkspace: () =>
    request<{ reset: boolean }>("/admin/reset", { method: "POST" }),
};

export function uploadDocuments(
  files: File[],
  onProgress?: (percent: number) => void,
): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    files.forEach((file) => form.append("files", file));
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE}/ingest`);
    xhr.responseType = "text";
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onerror = () => reject(new ApiError("Upload failed. Is the Helium API running?", 0));
    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        body = xhr.responseText;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(100);
        resolve(body as UploadResult);
        return;
      }
      const detail =
        body && typeof body === "object" && "detail" in body
          ? (body as { detail: unknown }).detail
          : body;
      reject(
        new ApiError(
          errorMessage(detail, `Upload failed with status ${xhr.status}`),
          xhr.status,
          detail,
        ),
      );
    };
    xhr.send(form);
  });
}

export interface StreamCallbacks {
  onStatus?: (status: { stage: string; message: string }) => void;
  onAnalysis?: (payload: {
    query_id: string;
    metrics: QueryMetrics;
    consistency_score: number;
    chunks_analyzed: number;
    conflicts: Conflict[];
    citations: Citation[];
    claims: Claim[];
    relationships: Conflict[];
  }) => void;
  onDelta?: (text: string) => void;
  onComplete?: (result: QueryResult) => void;
}

function parseSseBlock(
  block: string,
  callbacks: StreamCallbacks,
): { completed: boolean; error: string | null } {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  if (!dataLines.length) return { completed: false, error: null };
  let payload: unknown;
  try {
    payload = JSON.parse(dataLines.join("\n"));
  } catch {
    return { completed: false, error: null };
  }
  switch (event) {
    case "status":
      callbacks.onStatus?.(payload as { stage: string; message: string });
      break;
    case "analysis":
      callbacks.onAnalysis?.(
        payload as {
          query_id: string;
          metrics: QueryMetrics;
          consistency_score: number;
          chunks_analyzed: number;
          conflicts: Conflict[];
          citations: Citation[];
          claims: Claim[];
          relationships: Conflict[];
        },
      );
      break;
    case "delta":
      callbacks.onDelta?.((payload as { text: string }).text);
      break;
    case "complete":
      callbacks.onComplete?.(payload as QueryResult);
      return { completed: true, error: null };
    case "error":
      return {
        completed: false,
        error: (payload as { message?: string }).message || "The query failed.",
      };
    default:
      break;
  }
  return { completed: false, error: null };
}

export async function streamQuery(
  query: string,
  topK: number,
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
): Promise<QueryResult | null> {
  const response = await fetch(`${API_BASE}/query/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({ query, top_k: topK }),
    signal,
    cache: "no-store",
  });
  if (!response.ok) {
    const text = await response.text();
    let detail: unknown = text;
    try {
      const parsed = JSON.parse(text);
      detail = parsed.detail ?? parsed;
    } catch {
      // Keep text.
    }
    throw new ApiError(errorMessage(detail, "Query failed."), response.status, detail);
  }
  if (!response.body) {
    throw new ApiError("Streaming is not supported by this browser.", 0);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed = false;
  let finalResult: QueryResult | null = null;

  const originalComplete = callbacks.onComplete;
  callbacks.onComplete = (result) => {
    finalResult = result;
    originalComplete?.(result);
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let separator = buffer.search(/\r?\n\r?\n/);
      while (separator !== -1) {
        const match = buffer.match(/\r?\n\r?\n/);
        const length = match?.[0].length ?? 2;
        const block = buffer.slice(0, separator);
        buffer = buffer.slice(separator + length);
        const parsed = parseSseBlock(block, callbacks);
        if (parsed.error) throw new ApiError(parsed.error, 0);
        if (parsed.completed) completed = true;
        separator = buffer.search(/\r?\n\r?\n/);
      }
    }
    if (buffer.trim()) {
      const parsed = parseSseBlock(buffer, callbacks);
      if (parsed.error) throw new ApiError(parsed.error, 0);
      if (parsed.completed) completed = true;
    }
  } finally {
    reader.releaseLock();
  }
  if (!completed && !finalResult) {
    throw new ApiError("The analysis stream ended unexpectedly.", 0);
  }
  return finalResult;
}
