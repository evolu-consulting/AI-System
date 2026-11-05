// CR-121 · R-3: sơ đồ ngang các bước của lượt chạy (hạt sáng tới bước đang chạy, viền nhấp nháy). Bấm bước ⇒ mở nhật ký bước.
import type { RunDetailStep } from "@ai/contracts/chat";
import {
  Bell,
  Check,
  CircleDashed,
  CircleHelp,
  Clock,
  Loader2,
  Minus,
  TriangleAlert,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { type NodeTone, nodeKindOf } from "../../lib/run-detail-view";

const TONE_CLASS: Record<NodeTone, string> = {
  ok: "border-success/40 bg-success-bg text-success",
  err: "border-destructive/50 bg-danger-bg text-danger",
  run: "border-primary/60 bg-accent text-accent-foreground",
  wait: "border-warning-solid/60 bg-warning-bg text-warning",
  off: "border-border bg-muted text-muted-strong-foreground",
  dim: "border-dashed border-border bg-card text-muted-foreground",
};

const ICON: Record<RunDetailStep["state"], ReactNode> = {
  done: <Check aria-hidden />,
  running: <Loader2 aria-hidden className="animate-spin motion-reduce:animate-none" />,
  error: <X aria-hidden />,
  needs_decision: <TriangleAlert aria-hidden />,
  skipped: <Minus aria-hidden />,
  not_reached: <CircleDashed aria-hidden />,
  cancelled: <CircleHelp aria-hidden />,
};

/** CR-121 D-6b · biểu tượng loại bước Thông báo (chuông) / Chờ tới (đồng hồ); nhãn hiện khi rê chuột (icon-only). */
const KIND_ICON: Record<string, ReactNode> = {
  notify: <Bell aria-hidden />,
  wait_until: <Clock aria-hidden />,
};

type Props = {
  steps: readonly RunDetailStep[];
  selected: number | null;
  onSelect: (idx: number) => void;
};

export function RunFlow({ steps, selected, onSelect }: Props) {
  const { t } = useTranslation();
  return (
    <ol
      aria-label={t("process.admin.runDetail.flow")}
      className="m-0 flex list-none items-stretch gap-0 overflow-x-auto p-3"
    >
      {steps.map((s, i) => {
        const k = nodeKindOf(s.state);
        const stateText = t(`process.admin.runDetail.state.${s.state}`);
        return (
          <li key={s.idx} className="flex items-center">
            {i > 0 && (
              <span
                aria-hidden
                data-testid="run-link"
                className={cn(
                  "relative mx-1 h-0.5 w-10 shrink-0 rounded bg-border",
                  k.reached && "bg-primary/50",
                )}
              >
                {k.particle && <span className="run-part" />}
              </span>
            )}
            <button
              type="button"
              data-testid="run-step"
              data-state={s.state}
              aria-label={t("process.admin.runDetail.stepAria", {
                n: s.idx + 1,
                name: s.name,
                state: stateText,
              })}
              aria-current={selected === s.idx ? "step" : undefined}
              onClick={() => onSelect(s.idx)}
              className={cn(
                "relative flex w-36 shrink-0 flex-col gap-1 rounded-2xl border p-3 text-left transition-colors hover:brightness-95 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [&_svg]:size-4",
                TONE_CLASS[k.tone],
                selected === s.idx && "ring-2 ring-ring",
              )}
            >
              {k.pulse && (
                <span
                  aria-hidden
                  className={k.pulse === "acc" ? "run-nb run-nb-acc" : "run-nb run-nb-warn"}
                />
              )}
              <span className="flex items-center gap-1.5 text-label font-medium">
                {ICON[s.state]}
                {s.idx + 1}
                {KIND_ICON[s.executor.kind] ? (
                  <span
                    className="ml-auto"
                    title={t(`process.admin.runDetail.kind.${s.executor.kind}`)}
                  >
                    {KIND_ICON[s.executor.kind]}
                  </span>
                ) : null}
              </span>
              <span className="line-clamp-2 text-body font-medium break-words text-foreground">
                {s.name}
              </span>
              <span className="text-caption">{stateText}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
