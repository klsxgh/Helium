"use client";

import * as React from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  CalendarClock,
  ChevronDown,
  CircleCheck,
  CircleHelp,
  ExternalLink,
  FileSearch,
  Gauge,
  GitCompareArrows,
  Layers,
  ListFilter,
  Scale,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";

import type { Claim, Conflict, ReviewAction, ScoreBreakdown } from "@/lib/api";
import type { AnalysisSnapshot, ChatEntry } from "@/lib/chat";
import {
  cn,
  formatDate,
  healthColor,
  healthLabel,
  pluralize,
  relationshipMeta,
  truncate,
} from "@/lib/utils";

import { ConflictCard } from "./ConflictCard";
import {
  Badge,
  Button,
  EmptyState,
  IconButton,
  ScoreRing,
  Segmented,
  Skeleton,
} from "./ui";

export type InspectorTab = "consistency" | "claims" | "sources";

const TAB_OPTIONS = [
  { value: "consistency" as const, label: "Report" },
  { value: "claims" as const, label: "Claims" },
  { value: "sources" as const, label: "Passages" },
];

const SCORE_WEIGHTS: Record<string, number> = {
  agreement: 1,
  equivalence: 1,
  ambiguity: 0.45,
  conditional_conflict: 0.15,
  contradiction: 0,
};

const SCORE_ORDER = [
  "agreement",
  "equivalence",
  "ambiguity",
  "conditional_conflict",
  "contradiction",
] as const;

const SCORE_MEANINGS: Record<string, string> = {
  agreement: "Same meaning, different wording. Earns full credit.",
  equivalence: "Close restatements of each other. Earns full credit.",
  ambiguity: "Related but unclear or less specific. Earns 45% credit.",
  conditional_conflict: "Disagree only under certain conditions. Earns 15% credit.",
  contradiction: "Directly contradict each other. Earns no credit.",
};

function InspectorHeader({
  entry,
  report,
  onOpenReview,
  onCloseMobile,
}: {
  entry: ChatEntry | null;
  report: AnalysisSnapshot | null;
  onOpenReview: () => void;
  onCloseMobile?: () => void;
}) {
  return (
    <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-border px-3">
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="flex h-5 w-5 items-center justify-center rounded bg-primary/10 text-primary">
          <Gauge className="h-3 w-3" />
        </span>
        <div className="min-w-0">
          <h2 className="text-[12px] font-semibold tracking-[-0.01em]">Consistency Inspector</h2>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <IconButton label="Review queue" onClick={onOpenReview} className="h-7 w-7">
          <AlertTriangle className="h-3.5 w-3.5" />
        </IconButton>
        {onCloseMobile ? (
          <IconButton label="Close report" onClick={onCloseMobile} className="xl:hidden">
            <X className="h-4 w-4" />
          </IconButton>
        ) : null}
      </div>
      {entry ? (
        <span className="sr-only">
          {report ? `${report.conflicts.length} conflicts` : "No report"}
        </span>
      ) : null}
    </div>
  );
}

export interface ScoreBreakdownReport {
  consistency_score: number;
  relationships: Array<{ relationship: string }>;
  claims?: Array<unknown>;
  claims_analyzed?: number;
  score_breakdown?: ScoreBreakdown | null;
  metrics?: { score_breakdown?: ScoreBreakdown };
}

export function ScoreBreakdownPanel({ report }: { report: ScoreBreakdownReport }) {
  const data = report.score_breakdown ?? report.metrics?.score_breakdown;
  const derivedCounts: Record<string, number> = {};
  report.relationships.forEach((item) => {
    derivedCounts[item.relationship] = (derivedCounts[item.relationship] ?? 0) + 1;
  });
  const counts = data?.counts ?? derivedCounts;
  const total = data?.total_relationships ?? report.relationships.length;
  const weights = data?.weights ?? SCORE_WEIGHTS;
  const score = data?.score ?? report.consistency_score;
  const claimsCompared =
    data?.claims_compared ?? report.claims?.length ?? report.claims_analyzed ?? 0;

  const components = SCORE_ORDER.map((relationship) => {
    const count = counts[relationship] ?? 0;
    const weight = weights[relationship] ?? SCORE_WEIGHTS[relationship] ?? 0;
    return {
      relationship,
      count,
      weight,
      points: total ? Math.round((weight * count * 1000) / total) / 10 : 0,
    };
  });

  return (
    <details className="group mt-2.5 rounded-lg border border-border/70 bg-background/40">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-2.5 py-2 text-[10px] font-medium text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
        <CircleHelp className="h-3 w-3 shrink-0" />
        How is this score calculated?
        <ChevronDown className="ml-auto h-3 w-3 shrink-0 transition-transform group-open:rotate-180" />
      </summary>

      <div className="space-y-2.5 border-t border-border/70 px-2.5 py-2.5">
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          Every pair of related claims is labelled by how the two claims relate to each other. Each
          label earns a fixed amount of credit, and the score is the average credit across all{" "}
          {pluralize(total, "related pair")}.
        </p>

        <div className="space-y-1">
          {components.map((component) => {
            const meta = relationshipMeta[component.relationship as keyof typeof relationshipMeta];
            const active = component.count > 0;
            return (
              <div
                key={component.relationship}
                className={cn(
                  "flex items-center gap-1.5 text-[10px]",
                  active ? "text-foreground" : "opacity-45",
                )}
                title={SCORE_MEANINGS[component.relationship]}
              >
                <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", meta.dot)} />
                <span className="min-w-[74px] text-muted-foreground">{meta.short}</span>
                <span className="w-5 text-right tabular-nums">{component.count}</span>
                <span className="w-11 text-right tabular-nums text-muted-foreground">
                  x{Math.round(component.weight * 100)}%
                </span>
                <span className="ml-auto font-medium tabular-nums">
                  +{component.points} pts
                </span>
              </div>
            );
          })}
        </div>

        <div className="rounded-md bg-muted/40 px-2 py-1.5 text-[9.5px] leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">Formula: </span>
          (agreement + equivalence + 0.45 x ambiguity + 0.15 x conditional) / related pairs x 100{" "}
          = <span className="font-semibold text-foreground">{score}%</span>
        </div>

        {total === 0 ? (
          <p className="text-[9.5px] leading-relaxed text-muted-foreground">
            {data?.default_reason ||
              "No related claim pairs were found, so there was nothing that could conflict. The set defaults to 100%."}
          </p>
        ) : (
          <p className="text-[9.5px] leading-relaxed text-muted-foreground">
            {pluralize(claimsCompared, "claim")} compared. The points column is how many of the final
            100 points each finding type contributed.
          </p>
        )}
      </div>
    </details>
  );
}

function ScoreSummary({ report }: { report: AnalysisSnapshot }) {
  const color = healthColor(report.consistency_score);
  const counts: Record<string, number> = {};
  report.relationships.forEach((item) => {
    counts[item.relationship] = (counts[item.relationship] ?? 0) + 1;
  });
  const total = report.relationships.length || 1;
  const issues = report.conflicts.length;
  const direct = counts.contradiction ?? 0;
  const conditional = counts.conditional_conflict ?? 0;
  const ambiguous = counts.ambiguity ?? 0;

  return (
    <div className="rounded-xl border border-border bg-surface p-3">
      <div className="flex items-start gap-3">
        <ScoreRing score={report.consistency_score} size={62} label="score" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[12px] font-semibold" style={{ color }}>
              {healthLabel(report.consistency_score)}
            </span>
            <Badge tone={issues ? "danger" : "success"}>
              {issues ? `${issues} issue${issues === 1 ? "" : "s"}` : "clear"}
            </Badge>
          </div>
          <p className="mt-1 text-[10.5px] leading-relaxed text-muted-foreground">
            {pluralize(report.claims.length, "claim")} compared across{" "}
            {pluralize(report.citations.length, "retrieved passage")}.
          </p>
          <div className="mt-1.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[9.5px] text-muted-foreground">
            {direct ? <span className="text-rose-500">{direct} direct</span> : null}
            {conditional ? <span className="text-amber-500">{conditional} conditional</span> : null}
            {ambiguous ? <span className="text-amber-500/90">{ambiguous} ambiguous</span> : null}
            {!issues ? <span className="text-emerald-500">No material conflict</span> : null}
          </div>
        </div>
      </div>

      <div className="mt-2.5 flex h-1.5 overflow-hidden rounded-full bg-muted">
        {(["contradiction", "conditional_conflict", "ambiguity", "equivalence", "agreement"] as const).map(
          (relationship) => {
            const count = counts[relationship] ?? 0;
            if (!count) return null;
            const meta = relationshipMeta[relationship];
            return (
              <span
                key={relationship}
                className={cn("h-full", meta.dot)}
                style={{ width: `${(count / total) * 100}%` }}
                title={`${count} ${meta.short}`}
              />
            );
          },
        )}
      </div>

      <ScoreBreakdownPanel report={report} />
    </div>
  );
}

function ConflictFilters({
  report,
  value,
  onChange,
}: {
  report: AnalysisSnapshot;
  value: string;
  onChange: (value: string) => void;
}) {
  const counts: Record<string, number> = {};
  report.relationships.forEach((item) => {
    counts[item.relationship] = (counts[item.relationship] ?? 0) + 1;
  });
  const options = [
    { value: "issues", label: "Issues", count: report.conflicts.length },
    { value: "all", label: "All", count: report.relationships.length },
    { value: "contradiction", label: "Direct", count: counts.contradiction ?? 0 },
    { value: "conditional_conflict", label: "Conditional", count: counts.conditional_conflict ?? 0 },
    { value: "ambiguity", label: "Ambiguous", count: counts.ambiguity ?? 0 },
    { value: "agreement", label: "Agreement", count: (counts.agreement ?? 0) + (counts.equivalence ?? 0) },
  ].filter((option) => option.value === "issues" || option.value === "all" || option.count > 0);

  return (
    <div className="scrollbar-none -mx-0.5 flex items-center gap-1 overflow-x-auto px-0.5 pb-0.5">
      <ListFilter className="mr-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-[3px] text-[9.5px] font-medium transition-colors",
            value === option.value
              ? "border-foreground/20 bg-foreground/[0.06] text-foreground"
              : "border-border bg-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {option.label}
          <span className="tabular font-mono text-[8.5px] opacity-60">{option.count}</span>
        </button>
      ))}
    </div>
  );
}

function ClaimRow({
  claim,
  index,
  onOpenCitation,
}: {
  claim: Claim;
  index: number;
  onOpenCitation: (chunkId: string) => void;
}) {
  const [expanded, setExpanded] = React.useState(false);
  return (
    <div className="rounded-lg border border-border bg-surface p-2.5">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded bg-muted font-mono text-[8.5px] text-muted-foreground">
          {String(index + 1).padStart(2, "0")}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1">
            <Badge
              tone={
                claim.modality === "prohibited"
                  ? "danger"
                  : claim.modality === "must"
                    ? "warning"
                    : claim.modality === "informational"
                      ? "neutral"
                      : "info"
              }
            >
              {claim.modality}
            </Badge>
            {claim.negation ? <Badge tone="danger">negation</Badge> : null}
            <span className="font-mono text-[9px] text-muted-foreground">
              {Math.round((claim.confidence || 0) * 100)}%
            </span>
            <span className="ml-auto truncate text-[9px] text-muted-foreground">
              {claim.section_heading || `p.${claim.page_number}`}
            </span>
          </div>
          <p
            className={cn(
              "mt-1 cursor-pointer text-[11px] leading-relaxed text-foreground/90",
              !expanded && "line-clamp-3",
            )}
            onClick={() => setExpanded((value) => !value)}
          >
            {claim.raw_text}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <button
              type="button"
              onClick={() => onOpenCitation(claim.chunk_id)}
              className="inline-flex min-w-0 items-center gap-1 text-[9.5px] font-medium text-primary hover:underline"
            >
              <FileSearch className="h-2.5 w-2.5 shrink-0" />
              <span className="truncate">{claim.source_filename}</span>
              <span className="shrink-0 font-normal text-muted-foreground">p.{claim.page_number}</span>
            </button>
            {claim.doc_date ? (
              <span className="ml-auto flex items-center gap-1 text-[9px] text-muted-foreground">
                <CalendarClock className="h-2.5 w-2.5" /> {formatDate(claim.doc_date)}
              </span>
            ) : null}
          </div>
          {claim.numeric_constraints.length || claim.conditions.length ? (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {claim.numeric_constraints.map((value) => (
                <Badge key={value} className="font-mono" tone="outline">
                  {value}
                </Badge>
              ))}
              {claim.conditions.map((value) => (
                <Badge key={value} tone="warning" className="max-w-full truncate" title={value}>
                  if {value}
                </Badge>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ClaimsTab({
  report,
  onOpenCitation,
}: {
  report: AnalysisSnapshot;
  onOpenCitation: (chunkId: string) => void;
}) {
  const [modality, setModality] = React.useState("all");
  const modalities = React.useMemo(() => {
    const set = new Set(report.claims.map((claim) => claim.modality));
    return ["all", ...Array.from(set)];
  }, [report.claims]);
  const claims = report.claims.filter(
    (claim) => modality === "all" || claim.modality === modality,
  );

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-[11.5px] font-medium text-foreground">
            {pluralize(report.claims.length, "claim")} extracted
          </p>
          <p className="text-[9.5px] text-muted-foreground">
            Entity, modality, negation, numerics, and conditions
          </p>
        </div>
        <select
          value={modality}
          onChange={(event) => setModality(event.target.value)}
          className="h-6 rounded-md border border-border bg-surface-subtle px-1.5 text-[10px] text-foreground focus:border-primary/40 focus:outline-none"
          aria-label="Filter claims by modality"
        >
          {modalities.map((value) => (
            <option key={value} value={value}>
              {value === "all" ? "All modalities" : value}
            </option>
          ))}
        </select>
      </div>

      {claims.length === 0 ? (
        <EmptyState
          icon={<Scale className="h-4 w-4" />}
          title="No claims for this filter"
          description="Try another modality. Retrieved text may contain no obligation-bearing sentences."
        />
      ) : (
        <div className="space-y-1.5">
          {claims.map((claim, index) => (
            <ClaimRow
              key={claim.claim_id}
              claim={claim}
              index={index}
              onOpenCitation={onOpenCitation}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SourcesTab({
  report,
  onOpenCitation,
}: {
  report: AnalysisSnapshot;
  onOpenCitation: (chunkId: string) => void;
}) {
  const maxScore = Math.max(...report.citations.map((citation) => citation.score), 0.0001);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[11.5px] font-medium text-foreground">
            {pluralize(report.citations.length, "retrieved passage")}
          </p>
          <p className="text-[9.5px] text-muted-foreground">
            Ranked by vector similarity · click to read the full passage
          </p>
        </div>
        <Badge tone="outline" className="font-mono">
          top {report.metrics?.top_k ?? report.citations.length}
        </Badge>
      </div>

      {report.citations.length === 0 ? (
        <EmptyState
          icon={<Layers className="h-4 w-4" />}
          title="No passages retrieved"
          description="The corpus may not contain a passage relevant to this question. Add a policy document and try again."
        />
      ) : (
        report.citations.map((citation) => (
          <button
            key={citation.chunk_id}
            type="button"
            onClick={() => onOpenCitation(citation.chunk_id)}
            className="group w-full rounded-lg border border-border bg-surface p-2.5 text-left transition-colors hover:border-primary/30 hover:bg-surface-subtle/40"
          >
            <div className="flex items-center gap-1.5">
              <span className="flex h-5 min-w-5 items-center justify-center rounded bg-primary/[0.08] px-1 font-mono text-[9px] font-semibold text-primary">
                {citation.label}
              </span>
              <span className="truncate text-[11px] font-medium text-foreground">
                {citation.filename}
              </span>
              <ExternalLink className="ml-auto h-3 w-3 shrink-0 text-muted-foreground/40 transition-colors group-hover:text-primary" />
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[9px] text-muted-foreground">
              <span>page {citation.page_number}</span>
              {citation.section_heading ? (
                <>
                  <span aria-hidden>·</span>
                  <span className="truncate">{citation.section_heading}</span>
                </>
              ) : null}
            </div>
            <p className="mt-1.5 line-clamp-3 text-[10.5px] leading-relaxed text-muted-foreground">
              {citation.quote}
            </p>
            <div className="mt-2 flex items-center gap-2">
              <div className="h-0.5 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary/60"
                  style={{ width: `${Math.max(4, (citation.score / maxScore) * 100)}%` }}
                />
              </div>
              <span className="font-mono text-[8.5px] text-muted-foreground">
                {citation.score.toFixed(3)}
              </span>
            </div>
          </button>
        ))
      )}
    </div>
  );
}


export interface InspectorProps {
  entry: ChatEntry | null;
  report: AnalysisSnapshot | null;
  streaming: boolean;
  tab: InspectorTab;
  onTabChange: (tab: InspectorTab) => void;
  onOpenCitation: (chunkId: string) => void;
  onDecide: (conflict: Conflict, action: ReviewAction, note?: string) => Promise<unknown>;
  onOpenReview: () => void;
  className?: string;
  onCloseMobile?: () => void;
}

export function Inspector({
  entry,
  report,
  streaming,
  tab,
  onTabChange,
  onOpenCitation,
  onDecide,
  onOpenReview,
  className,
  onCloseMobile,
}: InspectorProps) {
  const [filter, setFilter] = React.useState("issues");

  React.useEffect(() => {
    setFilter("issues");
  }, [entry?.id]);

  const conflicts = React.useMemo(() => {
    if (!report) return [];
    if (filter === "issues") return report.conflicts;
    if (filter === "all") return report.relationships;
    if (filter === "agreement") {
      return report.relationships.filter(
        (item) => item.relationship === "agreement" || item.relationship === "equivalence",
      );
    }
    return report.relationships.filter((item) => item.relationship === filter);
  }, [filter, report]);

  return (
    <aside
      data-tour="inspector"
      className={cn(
        "flex h-full min-h-0 w-full flex-col border-l border-border bg-surface/40 xl:w-[400px] xl:shrink-0",
        className,
      )}
    >
      <InspectorHeader
        entry={entry}
        report={report}
        onOpenReview={onOpenReview}
        onCloseMobile={onCloseMobile}
      />

      <div className="border-b border-border px-3 py-2">
        <Segmented
          options={TAB_OPTIONS}
          value={tab}
          onChange={(value) => onTabChange(value)}
          size="sm"
          className="w-full [&>button]:flex-1"
        />
        {entry ? (
          <p className="mt-1.5 truncate text-[10px] text-muted-foreground" title={entry.query}>
            <span className="text-foreground/80">“{truncate(entry.query, 56)}”</span>
          </p>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {!entry ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-surface-subtle text-muted-foreground">
              <GitCompareArrows className="h-5 w-5" />
            </div>
            <p className="text-[12px] font-medium text-foreground">Your consistency report</p>
            <p className="mt-1 max-w-[240px] text-[10.5px] leading-relaxed text-muted-foreground">
              Ask a question or reopen one from history. Helium will show the answer&apos;s citations,
              extracted claims, and any contradictions here.
            </p>
          </div>
        ) : streaming && !report ? (
          <div className="space-y-2">
            <Skeleton className="h-[112px] rounded-xl" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-24 rounded-xl" />
            <Skeleton className="h-24 rounded-xl" />
          </div>
        ) : !report ? (
          <EmptyState
            icon={<CircleHelp className="h-4 w-4" />}
            title="No analysis available"
            description="This query did not produce a consistency report. Re-run it to rebuild the analysis."
          />
        ) : tab === "consistency" ? (
          <div className="space-y-2.5">
            <ScoreSummary report={report} />

            <div id="conflict-list" className="space-y-2 pt-0.5">
              {report.relationships.length === 0 ? (
                <EmptyState
                  icon={<Sparkles className="h-4 w-4" />}
                  title="No comparable claims"
                  description="The retrieved passages did not contain enough structured claims to compare. Try a more specific policy question."
                />
              ) : (
                <>
                  <ConflictFilters report={report} value={filter} onChange={setFilter} />
                  {conflicts.length === 0 ? (
                    <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] px-3 py-5 text-center">
                      <CircleCheck className="mx-auto mb-1.5 h-5 w-5 text-emerald-500" />
                      <p className="text-[11px] font-medium text-foreground">
                        No {filter === "issues" ? "material issues" : "relationships"} in this view
                      </p>
                      <p className="mt-0.5 text-[10px] text-muted-foreground">
                        Switch the filter to inspect agreements and equivalences.
                      </p>
                    </div>
                  ) : (
                    conflicts.map((conflict) => (
                      <ConflictCard
                        key={conflict.id}
                        conflict={conflict}
                        onDecide={onDecide}
                        onOpenCitation={onOpenCitation}
                        defaultExpanded={false}
                      />
                    ))
                  )}
                </>
              )}
            </div>
          </div>
        ) : tab === "claims" ? (
          <ClaimsTab report={report} onOpenCitation={onOpenCitation} />
        ) : (
          <SourcesTab report={report} onOpenCitation={onOpenCitation} />
        )}
      </div>

      {entry ? (
        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border px-3 py-2">
          <p className="text-[9px] text-muted-foreground">
            {report?.conflicts.some(
              (conflict) => conflict.status === "open" || conflict.status === "flagged",
            ) ? (
              <span className="flex items-center gap-1 text-amber-500">
                <AlertTriangle className="h-2.5 w-2.5" /> Reviewer action required
              </span>
            ) : (
              <span className="flex items-center gap-1">
                <ShieldCheck className="h-2.5 w-2.5 text-emerald-500" /> No action required
              </span>
            )}
          </p>
          <Button variant="ghost" size="xs" onClick={onOpenReview} className="gap-1">
            Review queue <ArrowUpRight className="h-3 w-3" />
          </Button>
        </div>
      ) : null}
    </aside>
  );
}
