// CR-122 · U2b · FLOW2-FR-12: đích bước của flow — "Gộp tới" (`next_step`) cho mọi bước thường và "Theo kết quả chờ" (`wait_event.branches`:
// đã ký / từ chối / huỷ / hết hạn → mỗi kết quả một bước đích). Đích là SỐ BƯỚC; `remapStepRefs` giữ đúng khi chèn/kéo/xoá bước.
import { useTranslation } from "react-i18next";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useFlowCtx } from "../flow/flow-ctx";
import type { StageFormProps } from "./stage-form-props";

const NONE = "none";

type Opt = { step: number; label: string };

/** Các bước đứng SAU bước của stage (mỗi bước một mục, tên các stage nối bằng " + "). */
function laterSteps(all: StageFormProps["all"], step: number): Opt[] {
  const steps = [...new Set(all.filter((s) => s.step > step).map((s) => s.step))].sort(
    (a, b) => a - b,
  );
  return steps.map((st) => ({
    step: st,
    label: all
      .filter((s) => s.step === st)
      .map((s) => s.name || s.key)
      .join(" + "),
  }));
}

function StepSelect(p: {
  label: string;
  value: number | null;
  options: Opt[];
  none: string;
  disabled: boolean;
  testId: string;
  onChange: (v: number | null) => void;
}) {
  return (
    <div className="grid grid-cols-[8rem_minmax(0,1fr)] items-center gap-2">
      <Label>{p.label}</Label>
      <Select
        value={p.value === null ? NONE : String(p.value)}
        disabled={p.disabled}
        onValueChange={(v) => p.onChange(v === NONE ? null : Number(v))}
      >
        <SelectTrigger aria-label={p.label} data-testid={p.testId}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>{p.none}</SelectItem>
          {p.options.map((o) => (
            <SelectItem key={o.step} value={String(o.step)}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** Khoá kết thúc chờ: sự kiện chính + phụ + hết hạn. */
export const waitOutcomes = (w: { event?: string; also?: string[] }): string[] => [
  ...new Set([...(w.event ? [w.event] : []), ...(w.also ?? []), "timeout"]),
];

export function StageLinks({ stage, all, readOnly, onChange }: StageFormProps) {
  const { t } = useTranslation();
  const flow = useFlowCtx();
  if (!flow) return null;
  const options = laterSteps(all, stage.step);
  const none = t("process.admin.flow.link.next");
  const isWait = stage.executor === "wait_event";
  const branches = stage.wait.branches ?? [];
  const setBranch = (on: string, step: number | null) => {
    const rest = branches.filter((b) => b.on !== on);
    onChange({ wait: { ...stage.wait, branches: [...rest, { on, step }] } });
  };
  return (
    <div className="space-y-2" data-testid="stage-links">
      {isWait
        ? waitOutcomes(stage.wait).map((on) => (
            <StepSelect
              key={on}
              label={t(`process.admin.flow.link.on.${on.split(".").pop()}`, {
                defaultValue: on,
              })}
              value={branches.find((b) => b.on === on)?.step ?? null}
              options={options}
              none={none}
              disabled={readOnly}
              testId={`wait-branch-${on}`}
              onChange={(v) => setBranch(on, v)}
            />
          ))
        : null}
      {stage.outcome === undefined && !isWait ? (
        <StepSelect
          label={t("process.admin.flow.link.merge")}
          value={stage.nextStep ?? null}
          options={options}
          none={none}
          disabled={readOnly}
          testId="stage-next-step"
          onChange={(v) => onChange({ nextStep: v ?? undefined } as Partial<typeof stage>)}
        />
      ) : null}
    </div>
  );
}
