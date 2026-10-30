// CR-105 · B2: form một BƯỚC của khe trên Canvas — tên, mã phòng ban, người duyệt/hạn/nhắc/chuyển cấp, điều kiện (loại HĐ/giá trị).
// Sửa vào `stage.slotRaw` (+ `name`); khi Lưu Hub `fromStages` dựng lại `slot_body` từ `slot`. Bước Dify: chỉ xem.
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { StageDraft } from "../../lib/draft-types";
import {
  issueOf,
  type LibReviewStep,
  REMIND_MAX,
  REMIND_MIN,
  validateFlow,
} from "../../lib/flow-form";
import { defaultReviewSlot } from "../../lib/slot-canvas";
import { isSlotStep } from "../../lib/system-nodes";
import { ReviewFields } from "./FlowStepCard";
import type { GroupOption } from "./flow-step-props";

type Props = {
  stage: StageDraft;
  index: number;
  count: number;
  groups: readonly GroupOption[];
  onChange: (patch: Partial<StageDraft>) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
};

export function SlotStageForm({ stage, index, count, groups, onChange, onMove, onRemove }: Props) {
  const { t } = useTranslation();
  const f = (k: string, o?: Record<string, string | number>) =>
    t(`process.admin.library.form.${k}`, o);
  const slot = isSlotStep(stage) ? (stage.slotRaw ?? {}) : defaultReviewSlot(stage.name);
  const first = stage.step === 0;
  const issues = validateFlow([
    { ...slot, kind: "review", key: stage.key, name: stage.name } as LibReviewStep,
  ]).filter((i) => i.index === 0 && !(i.code === "FIRST_CONDITIONAL" && !first));
  const err = (field: string) => {
    const i = issueOf(issues, 0, field);
    return i ? f(`err.${i.code}`, { min: REMIND_MIN, max: REMIND_MAX }) : undefined;
  };
  if (slot.kind === "dify")
    return <p className="text-body text-muted-foreground">{f("difyCanvas")}</p>;
  const step = { ...slot, kind: "review", key: stage.key, name: stage.name } as LibReviewStep;
  const set = (p: Record<string, unknown>) => onChange({ slotRaw: { ...slot, ...p } });
  const btn = (label: string, icon: React.ReactNode, click: () => void, disabled = false) => (
    <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={click}>
      {icon}
      {label}
    </Button>
  );
  return (
    <div className="space-y-3" data-testid="slot-stage-form">
      <h3 className="text-label font-semibold">
        {index + 1}. {first ? f("firstName") : f("reviewStep")}
      </h3>
      <ReviewFields
        id={`slot-${stage.uid}`}
        step={step}
        groups={groups}
        err={err}
        first={first}
        onWhen={(when) => set({ when })}
        onPatch={(p) => {
          set(p);
          if (typeof p.name === "string") onChange({ name: p.name, slotRaw: { ...slot, ...p } });
        }}
      />
      <div className="flex flex-wrap gap-2 border-t border-border pt-3">
        {btn(
          f("up"),
          <ArrowUp aria-hidden className="size-4" />,
          () => onMove(-1),
          first || index <= 1,
        )}
        {btn(
          f("down"),
          <ArrowDown aria-hidden className="size-4" />,
          () => onMove(1),
          first || index >= count - 1,
        )}
        {btn(f("remove"), <Trash2 aria-hidden className="size-4" />, onRemove, first || count <= 1)}
      </div>
    </div>
  );
}
