"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";

import { cn, healthColor } from "@/lib/utils";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "outline";
type ButtonSize = "sm" | "md" | "icon" | "xs";

const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 active:bg-primary/95",
  secondary:
    "border border-border bg-surface text-foreground shadow-sm hover:bg-muted/70 active:bg-muted",
  ghost: "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
  danger:
    "border border-rose-500/25 bg-rose-500/10 text-rose-500 hover:bg-rose-500/15 hover:text-rose-400",
  outline:
    "border border-border bg-transparent text-foreground hover:border-foreground/20 hover:bg-muted/50",
};

const buttonSizes: Record<ButtonSize, string> = {
  md: "h-9 gap-2 rounded-lg px-3.5 text-[13px]",
  sm: "h-8 gap-1.5 rounded-lg px-2.5 text-[12px]",
  xs: "h-7 gap-1.5 rounded-md px-2 text-[11px]",
  icon: "h-9 w-9 rounded-lg",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "secondary", size = "md", loading, children, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={props.type ?? "button"}
      disabled={disabled || loading}
      className={cn(
        "inline-flex select-none items-center justify-center whitespace-nowrap font-medium transition-colors duration-150 disabled:pointer-events-none disabled:opacity-45",
        buttonVariants[variant],
        buttonSizes[size],
        className,
      )}
      {...props}
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
});

export const IconButton = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }
>(function IconButton({ className, label, children, ...props }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground disabled:pointer-events-none disabled:opacity-40",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
});

type BadgeTone = "neutral" | "info" | "success" | "warning" | "danger" | "outline";

const badgeTones: Record<BadgeTone, string> = {
  neutral: "border-border bg-muted/60 text-muted-foreground",
  info: "border-primary/25 bg-primary/[0.08] text-primary",
  success: "border-emerald-500/25 bg-emerald-500/10 text-emerald-500",
  warning: "border-amber-500/30 bg-amber-500/10 text-amber-500",
  danger: "border-rose-500/30 bg-rose-500/10 text-rose-500",
  outline: "border-border bg-transparent text-muted-foreground",
};

export function Badge({
  tone = "neutral",
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium leading-4 tracking-[0.02em]",
        badgeTones[tone],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("h-4 w-4 animate-spin text-muted-foreground", className)} />;
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-md bg-muted-foreground/[0.08]",
        className,
      )}
    />
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-border bg-surface-subtle px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
      {children}
    </kbd>
  );
}

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  count?: number;
  icon?: React.ReactNode;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
  size = "md",
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <div
      role="tablist"
      className={cn(
        "inline-flex items-center gap-0.5 rounded-lg border border-border bg-surface-subtle p-0.5",
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-[6px] font-medium transition-colors",
              size === "sm" ? "h-6 px-2 text-[11px]" : "h-7 px-2.5 text-[11.5px]",
              active
                ? "bg-surface text-foreground shadow-sm ring-1 ring-border/80"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.icon}
            <span className="truncate">{option.label}</span>
            {typeof option.count === "number" ? (
              <span
                className={cn(
                  "tabular rounded px-1 text-[9.5px]",
                  active ? "bg-muted text-muted-foreground" : "text-muted-foreground/70",
                )}
              >
                {option.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function ScoreRing({
  score,
  size = 64,
  stroke = 5,
  label,
}: {
  score: number;
  size?: number;
  stroke?: number;
  label?: string;
}) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, score));
  const offset = circumference - (clamped / 100) * circumference;
  const color = healthColor(clamped);

  return (
    <div
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`Consistency ${clamped}%`}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          className="text-muted"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 600ms ease, stroke 300ms ease" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span
          className="tabular font-mono font-semibold leading-none"
          style={{ color, fontSize: size > 56 ? 17 : 14 }}
        >
          {clamped}
          <span className="text-[0.6em] font-normal opacity-70">%</span>
        </span>
        {label ? (
          <span className="mt-0.5 text-[8px] uppercase tracking-[0.12em] text-muted-foreground">
            {label}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function ProgressBar({
  value,
  className,
  tone = "primary",
}: {
  value: number;
  className?: string;
  tone?: "primary" | "success" | "warning";
}) {
  const toneClass =
    tone === "success" ? "bg-emerald-500" : tone === "warning" ? "bg-amber-500" : "bg-primary";
  return (
    <div className={cn("h-1 w-full overflow-hidden rounded-full bg-muted", className)}>
      <div
        className={cn("h-full rounded-full transition-[width] duration-500 ease-out", toneClass)}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border border-dashed border-border px-6 py-10 text-center",
        className,
      )}
    >
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-surface-subtle text-muted-foreground">
        {icon}
      </div>
      <p className="text-[13px] font-medium text-foreground">{title}</p>
      <p className="mt-1 max-w-[280px] text-[11.5px] leading-relaxed text-muted-foreground">
        {description}
      </p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  className?: string;
}) {
  return (
    <div className={cn("rounded-lg border border-border bg-surface-subtle/50 px-2.5 py-2", className)}>
      <p className="micro-label">{label}</p>
      <p className="metric-value mt-1 truncate">{value}</p>
      {hint ? <p className="mt-0.5 text-[10px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function InlineMarkdown({ text }: { text: string }) {
  const html = React.useMemo(() => {
    const escaped = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\*\*(.+?)\*\*/g, '<strong class="font-semibold text-foreground">$1</strong>')
      .replace(/`([^`]+)`/g, '<code class="rounded bg-muted px-1 py-0.5 font-mono text-[10.5px]">$1</code>');
    return { __html: escaped };
  }, [text]);
  return <span className="[&_strong]:text-foreground" dangerouslySetInnerHTML={html} />;
}
