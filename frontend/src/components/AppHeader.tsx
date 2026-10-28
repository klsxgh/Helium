"use client";

import * as React from "react";
import {
  AlertTriangle,
  MessageSquare,
  PanelLeft,
  PanelRight,
  Settings,
} from "lucide-react";

import type { RepositoryStats } from "@/lib/api";
import { cn } from "@/lib/utils";

import { IconButton } from "./ui";

export type MobilePane = "sources" | "chat" | "report";

export function AppHeader({
  stats,
  pane,
  onPaneChange,
  onOpenReview,
  onOpenSettings,
}: {
  stats: RepositoryStats | null;
  pane: MobilePane;
  onPaneChange: (pane: MobilePane) => void;
  onOpenReview: () => void;
  onOpenSettings: () => void;
}) {
  const flagged = stats?.open_conflicts ?? 0;

  const panes: { value: MobilePane; label: string; icon: React.ReactNode }[] = [
    { value: "sources", label: "Sources", icon: <PanelLeft className="h-3.5 w-3.5" /> },
    { value: "chat", label: "Chat", icon: <MessageSquare className="h-3.5 w-3.5" /> },
    { value: "report", label: "Report", icon: <PanelRight className="h-3.5 w-3.5" /> },
  ];

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-surface/70 px-3 backdrop-blur">
      <div className="flex shrink-0 items-center gap-2">
        <img
          src="/helium-mark.png"
          alt="Helium"
          width={26}
          height={26}
          className="h-[26px] w-[26px] rounded-[7px] shadow-sm"
        />
        <span className="text-[13px] font-semibold tracking-[-0.02em] text-foreground">Helium</span>
      </div>

      <div className="ml-auto flex items-center gap-1.5">
        <button
          type="button"
          data-tour="review"
          onClick={onOpenReview}
          className="relative inline-flex h-7 items-center gap-1.5 rounded-lg border border-border bg-surface px-2 text-[10px] font-medium text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground"
        >
          <AlertTriangle className="h-3 w-3" />
          <span className="hidden sm:inline">Review</span>
          {flagged > 0 ? (
            <span className="flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-rose-500 px-1 font-mono text-[8px] font-bold text-white">
              {flagged > 99 ? "99+" : flagged}
            </span>
          ) : null}
        </button>

        <IconButton
          label="Settings and tour"
          data-tour="settings"
          onClick={onOpenSettings}
          className="h-7 w-7 border border-border bg-surface"
        >
          <Settings className="h-3.5 w-3.5" />
        </IconButton>

        <div className="flex items-center gap-0.5 rounded-lg border border-border bg-surface-subtle p-0.5 xl:hidden">
          {panes.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => onPaneChange(item.value)}
              aria-label={item.label}
              title={item.label}
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded-[5px] transition-colors",
                pane === item.value
                  ? "bg-surface text-foreground shadow-sm ring-1 ring-border"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {item.icon}
            </button>
          ))}
        </div>
      </div>
    </header>
  );
}
