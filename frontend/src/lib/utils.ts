import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { Claim, Conflict, RelationshipType, Severity } from "./api";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export function formatMs(milliseconds: number): string {
  if (!Number.isFinite(milliseconds)) return "—";
  if (milliseconds < 1000) return `${Math.round(milliseconds)}ms`;
  return `${(milliseconds / 1000).toFixed(2)}s`;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function relativeTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const delta = Date.now() - date.getTime();
  const minutes = Math.round(delta / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(value);
}

export function extractYear(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = value.match(/\b(19|20)\d{2}\b/);
  return match ? match[0] : null;
}

export function newestClaim(conflict: Conflict): Claim {
  const left = claimScore(conflict.claim_a);
  const right = claimScore(conflict.claim_b);
  return right > left ? conflict.claim_b : conflict.claim_a;
}

export function oldestClaim(conflict: Conflict): Claim {
  return newestClaim(conflict) === conflict.claim_a ? conflict.claim_b : conflict.claim_a;
}

function claimScore(claim: Claim): number {
  return Number(
    `${claim.doc_date || "0000-00-00"}`.replaceAll("-", "") + String(claim.version || 1).padStart(3, "0"),
  );
}

export const relationshipMeta: Record<
  RelationshipType,
  { label: string; short: string; tone: string; dot: string; border: string; bg: string }
> = {
  contradiction: {
    label: "Direct contradiction",
    short: "Contradiction",
    tone: "text-rose-500",
    dot: "bg-rose-500",
    border: "border-rose-500/30",
    bg: "bg-rose-500/10",
  },
  conditional_conflict: {
    label: "Conditional conflict",
    short: "Conditional",
    tone: "text-amber-500",
    dot: "bg-amber-500",
    border: "border-amber-500/30",
    bg: "bg-amber-500/10",
  },
  ambiguity: {
    label: "Ambiguity",
    short: "Ambiguous",
    tone: "text-amber-500",
    dot: "bg-amber-500",
    border: "border-amber-500/30",
    bg: "bg-amber-500/10",
  },
  agreement: {
    label: "Agreement",
    short: "Agreement",
    tone: "text-emerald-500",
    dot: "bg-emerald-500",
    border: "border-emerald-500/30",
    bg: "bg-emerald-500/10",
  },
  equivalence: {
    label: "Equivalence",
    short: "Equivalent",
    tone: "text-emerald-500",
    dot: "bg-emerald-500",
    border: "border-emerald-500/30",
    bg: "bg-emerald-500/10",
  },
};

export const severityMeta: Record<Severity, { label: string; className: string }> = {
  critical: { label: "Critical", className: "text-rose-500 border-rose-500/30 bg-rose-500/10" },
  high: { label: "High", className: "text-rose-400 border-rose-500/25 bg-rose-500/[0.07]" },
  medium: { label: "Medium", className: "text-amber-500 border-amber-500/30 bg-amber-500/10" },
  low: { label: "Low", className: "text-zinc-500 border-zinc-500/25 bg-zinc-500/10" },
  info: { label: "Info", className: "text-emerald-500 border-emerald-500/25 bg-emerald-500/10" },
};

export function healthLabel(score: number): string {
  if (score >= 85) return "Consistent";
  if (score >= 70) return "Mostly consistent";
  if (score >= 50) return "Needs review";
  return "Conflicting";
}

export function healthColor(score: number): string {
  if (score >= 85) return "#10b981";
  if (score >= 70) return "#f59e0b";
  if (score >= 50) return "#f59e0b";
  return "#f43f5e";
}

export function fileKind(extension: string): "pdf" | "docx" | "txt" {
  if (extension === ".pdf") return "pdf";
  if (extension === ".docx") return "docx";
  return "txt";
}

export function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1).trimEnd()}…`;
}

export function humanizeStage(stage: string): string {
  return stage.replace(/_/g, " ");
}

export function pluralize(count: number, singular: string, plural?: string): string {
  return `${count} ${count === 1 ? singular : plural || `${singular}s`}`;
}
