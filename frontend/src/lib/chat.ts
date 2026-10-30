import type {
  Claim,
  Conflict,
  Citation,
  QueryMetrics,
  QueryResult,
  ScoreBreakdown,
} from "./api";

export interface AnalysisSnapshot {
  query_id: string;
  metrics: QueryMetrics;
  consistency_score: number;
  score_breakdown?: ScoreBreakdown;
  chunks_analyzed: number;
  conflicts: Conflict[];
  citations: Citation[];
  claims: Claim[];
  relationships: Conflict[];
}

export interface ChatEntry {
  id: string;
  query: string;
  topK: number;
  state: "streaming" | "complete" | "error" | "stopped";
  stage: string;
  statusText: string;
  answer: string;
  analysis?: AnalysisSnapshot;
  result?: QueryResult;
  error?: string;
  createdAt: string;
  elapsedMs?: number;
}

export function reportOf(entry: ChatEntry | null | undefined): AnalysisSnapshot | null {
  if (!entry) return null;
  if (entry.result) {
    return {
      query_id: entry.result.query_id,
      metrics: entry.result.metrics,
      consistency_score: entry.result.consistency_score,
      score_breakdown: entry.result.score_breakdown,
      chunks_analyzed: entry.result.chunks_analyzed,
      conflicts: entry.result.conflicts,
      citations: entry.result.citations,
      claims: entry.result.claims,
      relationships: entry.result.relationships,
    };
  }
  return entry.analysis ?? null;
}

export function entryTimestamp(entry: ChatEntry): string {
  return entry.result?.created_at || entry.createdAt;
}
