// ADM-FR-71 · HUB-FR-104 · HUB-FR-118 · P-b2: "Chạy ở bước" (spinbutton, đếm từ 1) và "Nếu bị trượt" (chọn bước được quay lại).
import { PROCESS_STAGES_MAX } from "@ai/contracts/hub-admin";
import { useTranslation } from "react-i18next";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { StageDraft } from "../../lib/def-form";
import { stepFromLabel, stepLabel } from "../../lib/step-label";
import { TextField } from "./Fields";
import type { StageFormProps } from "./stage-form-props";

const P = "process.admin.editor.stage.";

/** Tên các giai đoạn đang ở bước `step`, nối bằng dấu phẩy (mô tả cho checkbox quay lại). */
const namesAt = (all: readonly StageDraft[], step: number, unnamed: string): string =>
  all
    .filter((s) => s.step === step)
    .map((s) => s.name || unnamed)
    .join(", ");

function BackFields({ stage, all, readOnly, errors, index, onChange }: StageFormProps) {
  const { t } = useTranslation();
  const err = errors[`stages.${index}.after.back_to_steps`];
  const targets = Array.from({ length: stage.step }, (_, s) => s);
  const toggle = (s: number, on: boolean) =>
    onChange({
      backTo: [...new Set(on ? [...stage.backTo, s] : stage.backTo.filter((x) => x !== s))].sort(
        (a, b) => a - b,
      ),
    });
  if (stage.after !== "review" || stage.step === 0)
    return <p className="text-caption text-muted-foreground">{t(`${P}backNone`)}</p>;
  return (
    <>
      <p className="text-caption text-muted-foreground">{t(`${P}backHint`)}</p>
      {targets.map((s) => {
        const id = `${stage.uid}-back-${s}`;
        return (
          <div key={s} className="flex items-start gap-2">
            <Checkbox
              id={id}
              checked={stage.backTo.includes(s)}
              disabled={readOnly}
              aria-describedby={`${id}-hint`}
              onCheckedChange={(v) => toggle(s, v === true)}
            />
            <div className="space-y-0.5">
              <Label htmlFor={id}>{t(`${P}backOption`, { step: stepLabel(s) })}</Label>
              <p id={`${id}-hint`} className="text-caption text-muted-foreground">
                {t(`${P}backOptionHint`, {
                  names: namesAt(all, s, t(`${P}unnamed`)),
                })}
              </p>
            </div>
          </div>
        );
      })}
      {err ? <p className="text-caption text-destructive">{t(err)}</p> : null}
    </>
  );
}

export function StageStepFields(p: StageFormProps) {
  const { t } = useTranslation();
  const { stage, index, errors } = p;
  const stepErr = errors[`stages.${index}.step`];
  const msg = p.stepNotice ?? (stepErr ? t(stepErr, { step: stepLabel(stage.step) }) : undefined);
  return (
    <div className="space-y-3">
      <TextField
        id={`${stage.uid}-step`}
        label={t(`${P}step`)}
        description={t(`${P}stepHint`)}
        type="number"
        min={1}
        max={PROCESS_STAGES_MAX}
        value={String(stepLabel(stage.step))}
        error={msg}
        readOnly={p.readOnly}
        onChange={(v) => {
          const n = Math.round(Number(v));
          if (v.trim() !== "" && Number.isFinite(n))
            p.onStep(stepFromLabel(Math.min(Math.max(n, 1), PROCESS_STAGES_MAX)));
        }}
      />
      <fieldset className="space-y-2">
        <legend className="text-label font-medium">{t(`${P}back`)}</legend>
        <BackFields {...p} />
      </fieldset>
    </div>
  );
}
