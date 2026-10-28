"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import {
  Check,
  Compass,
  Cpu,
  Database,
  Gauge,
  Layers,
  Loader2,
  Moon,
  Server,
  ShieldCheck,
  Sparkles,
  Sun,
  Trash2,
  UserRound,
  X,
} from "lucide-react";

import type { HealthResponse } from "@/lib/api";
import { API_BASE } from "@/lib/api";
import { cn } from "@/lib/utils";

import { Badge, Button, IconButton } from "./ui";

const TOP_K_OPTIONS = [
  { value: 4, label: "4 chunks", hint: "Fastest" },
  { value: 6, label: "6 chunks", hint: "Light" },
  { value: 8, label: "8 chunks", hint: "Recommended" },
  { value: 12, label: "12 chunks", hint: "Deepest" },
];

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-b border-border px-4 py-4 last:border-0 sm:px-5">
      <div className="mb-3">
        <h3 className="text-[12px] font-semibold tracking-[-0.01em] text-foreground">{title}</h3>
        {description ? (
          <p className="mt-0.5 text-[10.5px] leading-relaxed text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

export interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  theme: "light" | "dark";
  onThemeChange: (theme: "light" | "dark") => void;
  topK: number;
  onTopKChange: (value: number) => void;
  reviewer: string;
  onReviewerChange: (value: string) => void;
  health: HealthResponse | null;
  backendError: string | null;
  hasDocuments: boolean;
  seeding: boolean;
  onSeedDemo: () => void;
  onReplayTour: () => void;
  onResetWorkspace: () => Promise<void>;
}

export function SettingsModal({
  open,
  onClose,
  theme,
  onThemeChange,
  topK,
  onTopKChange,
  reviewer,
  onReviewerChange,
  health,
  backendError,
  hasDocuments,
  seeding,
  onSeedDemo,
  onReplayTour,
  onResetWorkspace,
}: SettingsModalProps) {
  const [mounted, setMounted] = React.useState(false);
  const closeRef = React.useRef<HTMLButtonElement>(null);
  const [confirmReset, setConfirmReset] = React.useState(false);
  const [resetting, setResetting] = React.useState(false);

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

  const embedding = (health?.capabilities?.embedding ?? {}) as {
    backend?: string;
    model?: string;
    dimension?: number;
    fallback_reason?: string | null;
  };
  const backend =
    health?.index?.embedding?.backend ?? embedding.backend ?? "—";
  const model = health?.index?.embedding?.model ?? embedding.model ?? "—";
  const indexReady =
    health?.index?.status === "ready" ||
    health?.index?.status === "ok" ||
    health?.index?.status === "active";

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
        aria-labelledby="settings-title"
        className="flex max-h-[92dvh] w-full max-w-[620px] flex-col overflow-hidden rounded-t-2xl border border-border bg-surface shadow-2xl animate-fade-up sm:max-h-[86dvh] sm:rounded-2xl"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
          <div className="flex items-start gap-2.5">
            <span className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg border border-primary/20 bg-primary/[0.07] text-primary">
              <Compass className="h-4 w-4" />
            </span>
            <div>
              <h2 id="settings-title" className="text-[13px] font-semibold tracking-[-0.01em]">
                Settings
              </h2>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                Preferences, evidence depth, and the guided tour
              </p>
            </div>
          </div>
          <IconButton ref={closeRef} label="Close settings" onClick={onClose}>
            <X className="h-4 w-4" />
          </IconButton>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <Section
            title="Guided tour"
            description="A short walkthrough of every part of Helium. Play it whenever you need a refresher."
          >
            <button
              type="button"
              onClick={onReplayTour}
              className="flex w-full items-center gap-3 rounded-xl border border-primary/25 bg-primary/[0.04] px-3 py-2.5 text-left transition-colors hover:bg-primary/[0.07]"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-surface text-primary">
                <Compass className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[11.5px] font-medium text-foreground">
                  Replay the product tour
                </span>
                <span className="mt-0.5 block text-[10px] text-muted-foreground">
                  Points at sources, answers, the report, review, and settings.
                </span>
              </span>
              <span className="shrink-0 rounded-md border border-primary/20 bg-surface px-2 py-1 text-[10px] font-medium text-primary">
                Play
              </span>
            </button>
          </Section>

          <Section
            title="Appearance"
            description="Choose the theme that is easiest on your eyes. It applies immediately."
          >
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  { value: "light" as const, label: "Light", icon: Sun },
                  { value: "dark" as const, label: "Dark", icon: Moon },
                ] as const
              ).map((option) => {
                const Icon = option.icon;
                const active = theme === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => onThemeChange(option.value)}
                    aria-pressed={active}
                    className={cn(
                      "relative overflow-hidden rounded-xl border p-2.5 text-left transition-colors",
                      active
                        ? "border-primary/40 bg-primary/[0.04] ring-1 ring-primary/15"
                        : "border-border hover:border-foreground/20",
                    )}
                  >
                    <span
                      className={cn(
                        "mb-2 block h-10 rounded-md border border-border/70",
                        option.value === "light"
                          ? "bg-[linear-gradient(135deg,#f8fafc,#e2e8f0)]"
                          : "bg-[linear-gradient(135deg,#0b0f19,#1e293b)]",
                      )}
                    />
                    <span className="flex items-center gap-1.5 text-[11px] font-medium">
                      <Icon className="h-3 w-3" /> {option.label}
                    </span>
                    {active ? (
                      <span className="absolute right-2 top-2 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
                        <Check className="h-2.5 w-2.5" />
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </Section>

          <Section
            title="Evidence depth"
            description="How many source passages Helium reads for each question. More evidence means broader context and a slower answer."
          >
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {TOP_K_OPTIONS.map((option) => {
                const active = topK === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => onTopKChange(option.value)}
                    aria-pressed={active}
                    className={cn(
                      "rounded-lg border px-2 py-2 text-center transition-colors",
                      active
                        ? "border-primary/40 bg-primary/[0.05] text-foreground ring-1 ring-primary/15"
                        : "border-border text-muted-foreground hover:border-foreground/20 hover:text-foreground",
                    )}
                  >
                    <span className="block font-mono text-[11px] font-semibold">{option.label}</span>
                    <span className="mt-0.5 block text-[8.5px] uppercase tracking-wider opacity-70">
                      {option.hint}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="mt-2 flex items-center gap-1 text-[9.5px] text-muted-foreground">
              <Gauge className="h-3 w-3" /> {topK} passages per question · currently selected
            </p>
          </Section>

          <Section
            title="Reviewer identity"
            description="Your name is attached to every conflict decision you record."
          >
            <label className="flex h-9 items-center gap-2 rounded-lg border border-input bg-surface px-2.5 focus-within:border-primary/40 focus-within:ring-1 focus-within:ring-primary/10">
              <UserRound className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <input
                value={reviewer}
                onChange={(event) => onReviewerChange(event.target.value)}
                maxLength={120}
                placeholder="Compliance Reviewer"
                aria-label="Reviewer identity"
                className="min-w-0 flex-1 bg-transparent text-[11.5px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
              />
            </label>
            <p className="mt-1.5 flex items-center gap-1 text-[9px] text-muted-foreground">
              <ShieldCheck className="h-2.5 w-2.5 text-emerald-500" /> Signed decisions are append-only.
            </p>
          </Section>

          <Section
            title="Demo data"
            description="Three sample policies contain deliberate contradictions — useful for learning the report."
          >
            {hasDocuments ? (
              <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-subtle/50 px-2.5 py-2 text-[10.5px] text-muted-foreground">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                <span className="flex-1">Your workspace already has sources.</span>
                <Badge tone="success">ready</Badge>
              </div>
            ) : (
              <Button size="sm" variant="secondary" loading={seeding} onClick={onSeedDemo} className="gap-1.5">
                <Sparkles className="h-3.5 w-3.5" /> Load the demo corpus
              </Button>
            )}
          </Section>

          <details className="group border-b border-border px-4 py-4 last:border-0 sm:px-5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2">
              <span>
                <span className="flex items-center gap-1.5 text-[12px] font-semibold text-foreground">
                  <Server className="h-3.5 w-3.5 text-muted-foreground" /> Technical details
                </span>
                <span className="mt-0.5 block text-[10.5px] text-muted-foreground">
                  API, index, and embedding status for this workspace.
                </span>
              </span>
              <span className="text-[10px] font-medium text-muted-foreground group-open:hidden">Show</span>
              <span className="hidden text-[10px] font-medium text-muted-foreground group-open:inline">Hide</span>
            </summary>

            <div className="mt-3 space-y-2 rounded-xl border border-border bg-surface-subtle/40 p-3">
              <div className="flex items-center justify-between gap-2 text-[10px]">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Server className="h-3 w-3" /> API
                </span>
                <span className="flex items-center gap-1.5 font-mono text-foreground">
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      health?.status === "ok"
                        ? "bg-emerald-500"
                        : health
                          ? "bg-amber-500"
                          : "bg-rose-500",
                    )}
                  />
                  {health?.status === "ok" ? `v${health.version}` : health ? "degraded" : "offline"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 text-[10px]">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Cpu className="h-3 w-3" /> Embeddings
                </span>
                <span className="max-w-[65%] truncate text-right font-mono text-foreground" title={model}>
                  {backend}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 text-[10px]">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Database className="h-3 w-3" /> Vector index
                </span>
                <span className="flex items-center gap-1.5 font-mono text-foreground">
                  {health?.index?.index_type ?? "—"}
                  <Badge tone={indexReady ? "success" : "warning"}>
                    {health?.index?.status ?? "unknown"}
                  </Badge>
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 text-[10px]">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Layers className="h-3 w-3" /> Indexed vectors
                </span>
                <span className="font-mono text-foreground">{health?.index?.vectors ?? 0}</span>
              </div>
              <div className="flex items-center justify-between gap-2 text-[10px]">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Gauge className="h-3 w-3" /> Endpoint
                </span>
                <span className="max-w-[65%] truncate font-mono text-foreground">{API_BASE}</span>
              </div>
              {embedding.fallback_reason || backendError ? (
                <p className="rounded bg-amber-500/[0.07] px-2 py-1.5 text-[9px] leading-relaxed text-amber-600 dark:text-amber-400">
                  {backendError || embedding.fallback_reason}
                </p>
              ) : null}
            </div>
          </details>
          <Section
            title="Danger zone"
            description="Permanently delete all documents, reports, conflicts, and uploaded files. This cannot be undone."
          >
            {confirmReset ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10.5px] text-rose-500">Are you sure? This deletes everything.</span>
                <Button size="xs" variant="ghost" disabled={resetting} onClick={() => setConfirmReset(false)}>
                  Cancel
                </Button>
                <Button
                  size="xs"
                  variant="primary"
                  disabled={resetting}
                  onClick={async () => {
                    setResetting(true);
                    try {
                      await onResetWorkspace();
                      setConfirmReset(false);
                    } finally {
                      setResetting(false);
                    }
                  }}
                  className="gap-1 bg-rose-500 hover:bg-rose-600"
                >
                  {resetting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                  Delete everything
                </Button>
              </div>
            ) : (
              <Button
                size="xs"
                variant="secondary"
                className="gap-1 text-rose-500 hover:bg-rose-500/10"
                onClick={() => setConfirmReset(true)}
              >
                <Trash2 className="h-3 w-3" /> Delete all data and start over
              </Button>
            )}
          </Section>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-3 border-t border-border px-4 py-2.5 sm:px-5">
          <Button size="sm" variant="primary" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
