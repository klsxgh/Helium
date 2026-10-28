"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  Compass,
  Gauge,
  History,
  Layers,
  MessageSquare,
  Settings,
  Sparkles,
  UploadCloud,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";

import { Button, IconButton } from "./ui";

export type TourPane = "sources" | "chat" | "report";

interface TourStep {
  id: string;
  icon: React.ReactNode;
  title: string;
  body: string;
  target?: string;
  fallbackTarget?: string;
  pane?: TourPane;
  placement?: "top" | "bottom" | "left" | "right";
}

const STEPS: TourStep[] = [
  {
    id: "welcome",
    icon: <Compass className="h-4 w-4" />,
    title: "Welcome to Helium",
    body: "Ask a question across all of your policies, and see exactly which sources support the answer — including when those sources disagree.",
  },
  {
    id: "sources",
    icon: <Layers className="h-4 w-4" />,
    title: "Your source library",
    body: "Everything Helium knows lives here. Each PDF, DOCX, or TXT is parsed, split into sections, and indexed. Answers are grounded only in this evidence.",
    target: '[data-tour="sources"]',
    pane: "sources",
    placement: "right",
  },
  {
    id: "upload",
    icon: <UploadCloud className="h-4 w-4" />,
    title: "Add your policies",
    body: "Drag files here or browse. You can add up to 50 at once. Source documents stay read-only — Helium never rewrites them.",
    target: '[data-tour="upload"]',
    pane: "sources",
    placement: "right",
  },
  {
    id: "history",
    icon: <History className="h-4 w-4" />,
    title: "Revisit any report",
    body: "Every question is saved with its full consistency report, so you can reopen a past answer without asking again.",
    target: '[data-tour="sidebar-tabs"]',
    pane: "sources",
    placement: "right",
  },
  {
    id: "ask",
    icon: <MessageSquare className="h-4 w-4" />,
    title: "Ask in plain language",
    body: "Type a question the way you would ask a colleague. Helium retrieves the evidence, extracts claims, and checks every pair for agreement or contradiction.",
    target: '[data-tour="ask"]',
    pane: "chat",
    placement: "top",
  },
  {
    id: "report",
    icon: <Gauge className="h-4 w-4" />,
    title: "The consistency report",
    body: "After every answer, this panel shows a health score, any contradictions, the extracted claims, and the full source passages behind each citation.",
    target: '[data-tour="inspector"]',
    fallbackTarget: '[data-tour="report-toggle"]',
    pane: "report",
    placement: "left",
  },
  {
    id: "review",
    icon: <AlertTriangle className="h-4 w-4" />,
    title: "Resolve disagreements",
    body: "When sources conflict, open Review to enforce the newest source, keep the current one, or escalate. Helium never picks a winner on its own.",
    target: '[data-tour="review"]',
    pane: "chat",
    placement: "bottom",
  },
  {
    id: "settings",
    icon: <Settings className="h-4 w-4" />,
    title: "Make it yours",
    body: "Choose light or dark mode, set how much evidence Helium retrieves, update the reviewer name, or replay this tour whenever you need it.",
    target: '[data-tour="settings"]',
    pane: "chat",
    placement: "bottom",
  },
  {
    id: "finish",
    icon: <Sparkles className="h-4 w-4" />,
    title: "You're ready",
    body: "Start with a question, or load the demo corpus to see a real contradiction in under a minute. Your data stays in this workspace.",
  },
];

export function ProductTour({
  open,
  hasDocuments,
  onRequestPane,
  onFinish,
}: {
  open: boolean;
  hasDocuments: boolean;
  onRequestPane: (pane: TourPane) => void;
  onFinish: () => void;
}) {
  const [index, setIndex] = React.useState(0);
  const [rect, setRect] = React.useState<DOMRect | null>(null);
  const [measured, setMeasured] = React.useState(false);
  const [tooltipHeight, setTooltipHeight] = React.useState(216);
  const cardRef = React.useRef<HTMLDivElement>(null);
  const nextRef = React.useRef<HTMLButtonElement>(null);
  const [mounted, setMounted] = React.useState(false);
  const step = STEPS[index];
  const isLast = index === STEPS.length - 1;

  React.useEffect(() => setMounted(true), []);

  React.useEffect(() => {
    if (!open) return;
    setIndex(0);
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const currentStep = STEPS[index];
    if (currentStep.pane) onRequestPane(currentStep.pane);
    setMeasured(false);

    let first = 0;
    let second = 0;
    let timer = 0;

    const measure = () => {
      const selectors = [currentStep.target, currentStep.fallbackTarget].filter(
        (value): value is string => Boolean(value),
      );
      let element: Element | null = null;
      for (const selector of selectors) {
        const candidate = document.querySelector(selector);
        if (candidate) {
          const box = candidate.getBoundingClientRect();
          if (box.width > 0 && box.height > 0) {
            element = candidate;
            break;
          }
        }
      }
      if (!element) {
        setRect(null);
        setMeasured(true);
        return;
      }
      const box = element.getBoundingClientRect();
      if (box.bottom < 0 || box.top > window.innerHeight) {
        element.scrollIntoView({ block: "center", behavior: "smooth" });
        window.setTimeout(measure, 260);
        return;
      }
      setRect(box);
      setMeasured(true);
    };

    first = window.requestAnimationFrame(() => {
      second = window.requestAnimationFrame(measure);
    });
    timer = window.setTimeout(measure, 260);

    const onViewport = () => {
      const selectors = [currentStep.target, currentStep.fallbackTarget].filter(
        (value): value is string => Boolean(value),
      );
      const element = selectors
        .map((selector) => document.querySelector(selector))
        .find((candidate) => {
          if (!candidate) return false;
          const box = candidate.getBoundingClientRect();
          return box.width > 0 && box.height > 0;
        });
      setRect(element ? element.getBoundingClientRect() : null);
    };

    window.addEventListener("resize", onViewport);
    window.addEventListener("scroll", onViewport, true);
    return () => {
      window.cancelAnimationFrame(first);
      window.cancelAnimationFrame(second);
      window.clearTimeout(timer);
      window.removeEventListener("resize", onViewport);
      window.removeEventListener("scroll", onViewport, true);
    };
  }, [index, onRequestPane, open]);

  React.useLayoutEffect(() => {
    if (!open) return;
    const element = cardRef.current;
    if (element) setTooltipHeight(element.offsetHeight);
  }, [index, open, rect?.width, rect?.height]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onFinish();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        setIndex((current) => Math.min(STEPS.length - 1, current + 1));
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        setIndex((current) => Math.max(0, current - 1));
      }
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => nextRef.current?.focus(), 120);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
      window.clearTimeout(focusTimer);
    };
  }, [open, onFinish]);

  if (!mounted || !open) return null;

  const viewportWidth = typeof window !== "undefined" ? window.innerWidth : 1280;
  const viewportHeight = typeof window !== "undefined" ? window.innerHeight : 800;
  const width = Math.min(348, viewportWidth - 32);
  const margin = 16;
  const pad = 6;
  let left = (viewportWidth - width) / 2;
  let top = (viewportHeight - tooltipHeight) / 2;

  if (rect) {
    const placement = step.placement ?? "bottom";
    const gap = 16;
    const target = {
      left: rect.left - pad,
      top: rect.top - pad,
      right: rect.right + pad,
      bottom: rect.bottom + pad,
      width: rect.width + pad * 2,
      height: rect.height + pad * 2,
    };
    const fitsRight = target.right + gap + width <= viewportWidth - margin;
    const fitsLeft = target.left - gap - width >= margin;
    const fitsBelow = target.bottom + gap + tooltipHeight <= viewportHeight - margin;
    const fitsAbove = target.top - gap - tooltipHeight >= margin;

    if (placement === "right" && fitsRight) {
      left = target.right + gap;
      top = target.top + target.height / 2 - tooltipHeight / 2;
    } else if (placement === "left" && fitsLeft) {
      left = target.left - gap - width;
      top = target.top + target.height / 2 - tooltipHeight / 2;
    } else if (placement === "top" && fitsAbove) {
      left = target.left + target.width / 2 - width / 2;
      top = target.top - gap - tooltipHeight;
    } else if (fitsBelow) {
      left = target.left + target.width / 2 - width / 2;
      top = target.bottom + gap;
    } else if (fitsAbove) {
      left = target.left + target.width / 2 - width / 2;
      top = target.top - gap - tooltipHeight;
    } else if (fitsRight) {
      left = target.right + gap;
      top = target.top + target.height / 2 - tooltipHeight / 2;
    } else if (fitsLeft) {
      left = target.left - gap - width;
      top = target.top + target.height / 2 - tooltipHeight / 2;
    }
  }

  left = Math.max(margin, Math.min(left, viewportWidth - width - margin));
  top = Math.max(margin, Math.min(top, viewportHeight - tooltipHeight - margin));

  const finish = () => onFinish();
  const next = () => {
    if (isLast) finish();
    else setIndex((current) => Math.min(STEPS.length - 1, current + 1));
  };

  return createPortal(
    <div className="fixed inset-0 z-[100]" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      <div className="absolute inset-0" aria-hidden />
      {rect ? (
        <div
          className="pointer-events-none absolute rounded-xl border-2 border-primary/80 transition-all duration-200"
          style={{
            left: rect.left - pad,
            top: rect.top - pad,
            width: rect.width + pad * 2,
            height: rect.height + pad * 2,
            boxShadow: "0 0 0 9999px rgba(3, 7, 18, 0.62), 0 0 28px 2px hsl(var(--ring) / 0.35)",
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-[rgba(3,7,18,0.62)]" aria-hidden />
      )}

      <div
        ref={cardRef}
        className={cn(
          "fixed z-[110] rounded-xl border border-border bg-surface p-4 shadow-2xl transition-opacity duration-150",
          measured ? "opacity-100" : "opacity-0",
        )}
        style={{ left, top, width }}
      >
        <div className="flex items-start gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-primary/25 bg-primary/10 text-primary">
            {step.icon}
          </span>
          <div className="min-w-0 flex-1">
            <p className="micro-label">
              Step {index + 1} of {STEPS.length}
            </p>
            <h2 id="tour-title" className="mt-1 text-[14px] font-semibold tracking-[-0.015em]">
              {step.title}
            </h2>
          </div>
          <IconButton
            label="Skip tour"
            className="-mr-1 -mt-1 h-7 w-7"
            onClick={finish}
          >
            <X className="h-3.5 w-3.5" />
          </IconButton>
        </div>

        <p className="mt-2 text-[11.5px] leading-relaxed text-muted-foreground">
          {isLast && !hasDocuments
            ? "Start with a question, or close this tour and load the demo corpus to see a real contradiction in under a minute."
            : step.body}
        </p>

        <div className="mt-4 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            {STEPS.map((item, dotIndex) => (
              <button
                key={item.id}
                type="button"
                aria-label={`Go to step ${dotIndex + 1}: ${item.title}`}
                onClick={() => setIndex(dotIndex)}
                className={cn(
                  "h-1.5 rounded-full transition-all",
                  dotIndex === index
                    ? "w-4 bg-primary"
                    : dotIndex < index
                      ? "w-1.5 bg-primary/40"
                      : "w-1.5 bg-border",
                )}
              />
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            {index > 0 ? (
              <Button
                size="xs"
                variant="ghost"
                onClick={() => setIndex((current) => Math.max(0, current - 1))}
                className="gap-1"
              >
                <ArrowLeft className="h-3 w-3" /> Back
              </Button>
            ) : (
              <Button size="xs" variant="ghost" onClick={finish}>
                Skip
              </Button>
            )}
            <Button
              ref={nextRef}
              size="xs"
              variant="primary"
              onClick={next}
              className="gap-1"
            >
              {isLast ? (
                <>
                  <Check className="h-3 w-3" /> Start exploring
                </>
              ) : (
                <>
                  Next <ArrowRight className="h-3 w-3" />
                </>
              )}
            </Button>
          </div>
        </div>

        <p className="mt-2 text-right text-[8.5px] text-muted-foreground/60">
          Use arrow keys to navigate · Esc to skip
        </p>
      </div>
    </div>,
    document.body,
  );
}
