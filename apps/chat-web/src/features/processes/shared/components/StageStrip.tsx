// CR-056 · P-a plan-frontend-thread §4: thanh giai đoạn (tên + trạng thái). Chạy xong ⇒ toàn xanh. Trình bày thuần.
import type { StageRunStatus } from "@ai/contracts/chat";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "~/lib/utils";
import { stageStatusKey } from "../lib/status";

export type StageStripItem = { idx: number; name: string; status: StageRunStatus };

const DOT: Partial<Record<StageRunStatus, string>> = {
  done: "bg-success",
  running: "bg-primary",
  queued: "bg-primary/50",
  waiting_review: "bg-warning-solid",
  waiting_answer: "bg-warning-solid",
  needs_decision: "bg-destructive",
  failed: "bg-destructive",
};

export const StageStrip = memo(function StageStrip({
  stages,
  className,
}: {
  stages: readonly StageStripItem[];
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <ol className={cn("flex flex-wrap items-center gap-x-3 gap-y-1", className)}>
      {stages.map((s) => (
        <li
          key={s.idx}
          className="flex items-center gap-1.5 text-caption text-secondary-foreground"
        >
          <span
            aria-hidden
            className={cn("size-2 shrink-0 rounded-full", DOT[s.status] ?? "bg-border")}
          />
          <span className={cn(s.status === "pending" && "text-muted-foreground")}>{s.name}</span>
          <span className="sr-only">{t(stageStatusKey(s.status))}</span>
        </li>
      ))}
    </ol>
  );
});
