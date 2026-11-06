// CR-121 R6 · c16 · hàng chip (artboard AiTools): Tất cả · Đang bật · Chưa dùng + loại (Agent · Lệnh), ô "Tìm công cụ" bên phải.
import { Bot, Terminal, Workflow } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { SearchBox } from "@/components/shared/form/SearchBox";
import { cn } from "@/lib/utils";
import type { AiToolFilters, AiToolKind, StatusFilter, ToolCounts } from "../lib/ai-tools";

function Chip(p: {
  pressed: boolean;
  onClick: () => void;
  count: number | undefined;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={p.pressed}
      onClick={p.onClick}
      className={cn(
        "inline-flex h-8 items-center gap-2 rounded-full border px-3 text-body font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        p.pressed
          ? "border-primary/30 bg-accent text-accent-foreground"
          : "border-border bg-card text-foreground hover:bg-muted",
      )}
    >
      {p.children}
      {p.count === undefined ? null : <b className="font-semibold tabular-nums">{p.count}</b>}
    </button>
  );
}

type Props = {
  filters: AiToolFilters;
  counts: ToolCounts | undefined;
  onStatus: (s: StatusFilter | undefined) => void;
  onKind: (k: AiToolKind | undefined) => void;
  onQuery: (q: string) => void;
};

export function AiToolsToolbar({ filters, counts, onStatus, onKind, onQuery }: Props) {
  const { t } = useTranslation();
  const { status, kind } = filters;
  const toggleStatus = (s: StatusFilter) => onStatus(status === s ? undefined : s);
  const toggleKind = (k: AiToolKind) => onKind(kind === k ? undefined : k);
  return (
    <section aria-label={t("aiTools.chips.label")} className="flex flex-wrap items-center gap-2">
      <Chip
        pressed={!status && !kind}
        count={counts?.all}
        onClick={() => {
          onStatus(undefined);
          onKind(undefined);
        }}
      >
        {t("aiTools.chips.all")}
      </Chip>
      <Chip pressed={status === "on"} count={counts?.on} onClick={() => toggleStatus("on")}>
        <i aria-hidden className="size-2 rounded-full bg-success" />
        {t("aiTools.chips.on")}
      </Chip>
      <Chip
        pressed={status === "unused"}
        count={counts?.unused}
        onClick={() => toggleStatus("unused")}
      >
        <i aria-hidden className="size-2 rounded-full bg-muted-foreground" />
        {t("aiTools.chips.unused")}
      </Chip>
      <Chip pressed={kind === "agent"} count={counts?.agent} onClick={() => toggleKind("agent")}>
        <Bot aria-hidden className="size-3.5 text-muted-foreground" />
        {t("aiTools.chips.agent")}
      </Chip>
      <Chip
        pressed={kind === "command"}
        count={counts?.command}
        onClick={() => toggleKind("command")}
      >
        <Terminal aria-hidden className="size-3.5 text-muted-foreground" />
        {t("aiTools.chips.command")}
      </Chip>
      <Chip
        pressed={kind === "workflow"}
        count={counts?.workflow}
        onClick={() => toggleKind("workflow")}
      >
        <Workflow aria-hidden className="size-3.5 text-muted-foreground" />
        {t("aiTools.chips.workflow")}
      </Chip>
      <div className="ml-auto w-full sm:w-auto">
        <SearchBox label={t("aiTools.search")} value={filters.q ?? ""} onChange={onQuery} />
      </div>
    </section>
  );
}
