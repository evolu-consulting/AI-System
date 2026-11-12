// CR-127 · U2 · FLOW-FR-12…14 · spec §8.1 · mock Editor.dc: các KHỐI của sơ đồ soạn quy trình — Khi nào chạy, bước (ô icon + nhãn loại + tên + dòng phụ),
// "+" tròn viền đứt trên đường nối, Hoàn tất. Thuần hiển thị: cây + hành động do `OutlineView` giữ; vẽ vào node của xyflow ở `OutlineCanvas`.
import {
  ArrowDown,
  ArrowUp,
  Bell,
  Check,
  CircleAlert,
  Cog,
  Flag,
  GitBranch,
  Pencil,
  PenLine,
  Play,
  Plus,
  Timer,
  Trash2,
  Workflow,
} from "lucide-react";
import { useTranslation } from "react-i18next";

type LooseT = (key: string, opts?: Record<string, unknown>) => string;
/** Khoá `process.admin.*` nạp lười (không nằm trong kiểu khoá của `vi.json`) ⇒ `t` nhận chuỗi tự do. */
const useLooseT = () => useTranslation() as unknown as { t: LooseT };

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { NodeKind } from "../../lib/node-summary";
import { useFlowCtx, useRecordWords } from "../flow/flow-ctx";
import { NodeMenuContent, type PickedNode } from "../flow/NodeMenuContent";

/** Icon + màu ô icon theo loại bước (token của theme, không hex). */
const KIND_ICON: Record<NodeKind | "esign", { icon: typeof Check; tone: string }> = {
  approve: { icon: Check, tone: "bg-primary/10 text-primary" },
  form: { icon: Pencil, tone: "bg-muted text-muted-foreground" },
  if: { icon: GitBranch, tone: "bg-warning-bg text-warning" },
  esign: { icon: PenLine, tone: "bg-accent text-accent-foreground" },
  notify: { icon: Bell, tone: "bg-muted text-muted-foreground" },
  wait: { icon: Timer, tone: "bg-muted text-muted-foreground" },
  set: { icon: Cog, tone: "bg-muted text-muted-foreground" },
  tool: { icon: Cog, tone: "bg-muted text-muted-foreground" },
  agent: { icon: Cog, tone: "bg-muted text-muted-foreground" },
  subprocess: { icon: Workflow, tone: "bg-muted text-muted-foreground" },
  finish: { icon: Flag, tone: "bg-success-bg text-success" },
};

function KindIcon({ kind, className }: { kind: NodeKind | "esign"; className?: string }) {
  const { icon: Icon, tone } = KIND_ICON[kind];
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-[30px] shrink-0 items-center justify-center rounded-lg",
        tone,
        className,
      )}
    >
      <Icon className="size-4" />
    </span>
  );
}

/** «+» tròn viền đứt nằm TRÊN đường nối: mở menu nhóm nghiệp vụ, chọn xong chèn đúng chỗ này. */
export function AddGap(p: { onPick: (items: PickedNode[]) => void; room: number; testId: string }) {
  const { t } = useLooseT();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t("process.admin.flow.outline.add")}
          title={t("process.admin.flow.outline.add")}
          disabled={p.room < 1}
          data-testid={p.testId}
          className="nodrag nopan flex size-6 items-center justify-center rounded-full border border-dashed border-muted-foreground/60 bg-card text-muted-foreground hover:border-primary hover:text-primary focus-visible:outline-2 disabled:opacity-40"
        >
          <Plus aria-hidden className="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      <NodeMenuContent align="center" room={p.room} pick={p.onPick} />
    </DropdownMenu>
  );
}

const CARD =
  "flex h-full w-full items-center gap-3 rounded-xl border bg-card px-3.5 py-2.5 text-left text-body";
const KIND_LABEL = "text-caption font-bold uppercase leading-5 tracking-wide text-muted-foreground";

/** Khối Khi nào chạy: sự kiện (+ điều kiện); bấm mở thẻ sửa. */
export function StartRow() {
  const { t } = useLooseT();
  const ctx = useFlowCtx();
  if (!ctx?.trigger) return null;
  return (
    <button
      type="button"
      onClick={ctx.trigger.onOpen}
      data-testid="outline-start"
      className={cn(CARD, "border-primary/40 bg-accent/40 hover:bg-accent/60")}
    >
      <span
        aria-hidden
        className="flex size-[30px] shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground"
      >
        <Play className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn("block", KIND_LABEL, "text-primary")}>
          {t("process.admin.flow.outline.kindStart")}
        </span>
        <span className="block truncate text-label font-medium">{ctx.trigger.label}</span>
        {ctx.trigger.summary ? (
          <span className="block truncate text-caption text-muted-foreground">
            {ctx.trigger.summary}
          </span>
        ) : null}
      </span>
      <span className="text-caption text-muted-foreground">
        {t("process.admin.flow.outline.change")}
      </span>
    </button>
  );
}

/** Hoàn tất: cố định cuối quy trình, không xoá / không kéo; nói rõ kết cục của Duyệt / Từ chối / Trả lại. */
export function DoneRow() {
  const { t } = useLooseT();
  const { Record } = useRecordWords();
  return (
    <div data-testid="outline-done" className={cn(CARD, "border-success bg-success-bg")}>
      <span
        aria-hidden
        className="flex size-[30px] shrink-0 items-center justify-center rounded-lg bg-success text-primary-foreground"
      >
        <Flag className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn("block", KIND_LABEL, "text-success")}>
          {t("process.admin.flow.outline.done")}
        </span>
        <span className="block truncate text-label font-medium">
          {t("process.admin.flow.outline.doneTitle", { Record })}
        </span>
        <span className="line-clamp-2 text-caption text-muted-foreground">
          {t("process.admin.flow.outline.doneSub")}
        </span>
      </span>
    </div>
  );
}

export type StepRowProps = {
  uid: string;
  title: string;
  /** Nhãn loại in hoa nhỏ ("Duyệt", "Nếu", "Ký số"…). */
  kind: string;
  /** Loại để chọn icon + màu; vắng ⇒ bước chung. */
  kindId?: NodeKind | "esign";
  /** Dòng phụ (một dòng). */
  summary: string;
  errors: number;
  warn: boolean;
  selected: boolean;
  readOnly: boolean;
  canUp: boolean;
  canDown: boolean;
  onSelect: () => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
};

/** Một khối bước (mock Editor.dc `.step`): ô icon + nhãn loại + tên + dòng phụ + chip lỗi / lưu ý; lên / xuống / xoá hiện khi rê chuột / tab tới. */
export function StepRow(p: StepRowProps) {
  const { t } = useLooseT();
  const act = (label: string, onClick: () => void, icon: React.ReactNode, disabled = false) => (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-7"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {icon}
    </Button>
  );
  return (
    // biome-ignore lint/a11y/useSemanticElements: khối có nút con (lên / xuống / xoá) ⇒ không lồng <button> trong <button>
    <div
      role="button"
      tabIndex={0}
      data-testid={`outline-step-${p.uid}`}
      aria-pressed={p.selected}
      onClick={p.onSelect}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && p.onSelect()}
      className={cn(
        CARD,
        "group relative cursor-pointer hover:bg-accent/40",
        p.selected ? "border-primary ring-2 ring-primary" : "border-border",
      )}
    >
      <KindIcon kind={p.kindId ?? "set"} />
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate", KIND_LABEL)}>{p.kind}</span>
        <span className="block truncate text-label font-semibold">{p.title}</span>
        {p.summary ? (
          <span className="block truncate text-caption text-muted-foreground">{p.summary}</span>
        ) : null}
      </span>
      {p.errors > 0 ? (
        <span
          role="status"
          data-testid="outline-chip-error"
          className="flex shrink-0 items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-caption text-destructive"
        >
          <CircleAlert aria-hidden className="size-3" />
          {t("process.admin.flow.outline.needFix")}
        </span>
      ) : p.warn ? (
        <span
          role="status"
          data-testid="outline-chip-warn"
          className="shrink-0 rounded-full bg-warning/10 px-2 py-0.5 text-caption text-warning"
        >
          {t("process.admin.flow.outline.note")}
        </span>
      ) : null}
      {p.readOnly ? null : (
        <span className="nodrag nopan absolute -top-3.5 right-2 hidden items-center rounded-md border border-border bg-card shadow-sm group-focus-within:flex group-hover:flex">
          {act(
            t("process.admin.flow.outline.up"),
            () => p.onMove(-1),
            <ArrowUp className="size-4" />,
            !p.canUp,
          )}
          {act(
            t("process.admin.flow.outline.down"),
            () => p.onMove(1),
            <ArrowDown className="size-4" />,
            !p.canDown,
          )}
          {act(t("process.admin.flow.outline.remove"), p.onRemove, <Trash2 className="size-4" />)}
        </span>
      )}
    </div>
  );
}
