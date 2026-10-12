// ADM-FR-71 · P-b2 (plan-frontend FB3): danh sách giai đoạn theo bước, DOM thuần — fallback khi canvas đang tải/lỗi,
// chế độ "Danh sách" và đường bàn phím/đọc màn hình đầy đủ (mọi thao tác đổi bước làm được bằng nút ở panel).
import { PROCESS_STEP_STAGES_MAX } from "@ai/contracts/hub-admin";
import { Plus } from "lucide-react";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { StageOps } from "../../hooks/use-stage-ops";
import { StageBody, stageButtonClass } from "./StageBody";
import { onStageKeyDown } from "./stage-keys";
import { type StageView, sameView } from "./stage-view";

export type StepListProps = {
  views: readonly StageView[];
  selected: string | undefined;
  readOnly: boolean;
  ops: StageOps;
  onSelect: (uid: string, byKeyboard: boolean) => void;
  onRemove: (uid: string) => void;
};

const Row = memo(
  function Row({ v, p }: { v: StageView; p: StepListProps }) {
    return (
      <li>
        <button
          type="button"
          data-stage-uid={v.uid}
          aria-current={p.selected === v.uid ? "true" : undefined}
          className={stageButtonClass(v, p.selected === v.uid)}
          onClick={(e) => p.onSelect(v.uid, e.detail === 0)}
          onKeyDown={(e) =>
            onStageKeyDown(e, {
              uid: v.uid,
              index: v.index,
              step: v.step,
              readOnly: p.readOnly,
              ops: p.ops,
              onRemove: p.onRemove,
            })
          }
        >
          <StageBody v={v} />
        </button>
      </li>
    );
  },
  (a, b) =>
    sameView(a.v, b.v) &&
    (a.p.selected === a.v.uid) === (b.p.selected === b.v.uid) &&
    a.p.readOnly === b.p.readOnly,
);

export function StepList(p: StepListProps) {
  const { t } = useTranslation();
  const steps = [...new Set(p.views.map((v) => v.step))];
  if (steps.length === 0)
    return <p className="text-body text-muted-foreground">{t("process.admin.canvas.empty")}</p>;
  return (
    <ol aria-label={t("process.admin.canvas.title")} className="space-y-3">
      {steps.map((step) => {
        const items = p.views.filter((v) => v.step === step);
        const full = items.length >= PROCESS_STEP_STAGES_MAX;
        return (
          <li key={step} className="space-y-2">
            <h3 className="text-label font-medium">
              {t(
                items.length > 1
                  ? "process.admin.canvas.step.parallel"
                  : "process.admin.canvas.step.title",
                {
                  n: step + 1,
                },
              )}
            </h3>
            <ul className="grid gap-2 border-l border-border pl-3">
              {items.map((v) => (
                <Row key={v.uid} v={v} p={p} />
              ))}
            </ul>
            {p.readOnly ? null : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-disabled={full || undefined}
                className={full ? "opacity-50" : undefined}
                onClick={() => p.ops.add(step)}
              >
                <Plus aria-hidden className="size-4" />
                {t("process.admin.canvas.step.addTo", { n: step + 1 })}
              </Button>
            )}
          </li>
        );
      })}
    </ol>
  );
}
