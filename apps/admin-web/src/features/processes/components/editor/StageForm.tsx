// ADM-FR-66 · CR-056 · P-a F5 · P-b2: khung form một giai đoạn — `region "Giai đoạn n: <tên>"` (plan-frontend §1, e2e §2).
// Chi tiết từng phần ở StageGeneral/StageStepFields/StageGate/StageAnswerer/StageActions (tách — TECH-DEBT #136).
import { useTranslation } from "react-i18next";
import { isApply } from "../../lib/apply-form";
import { isWait } from "../../lib/wait-form";
import { StageActions } from "./StageActions";
import { StageAnswerer } from "./StageAnswerer";
import { StageApply } from "./StageApply";
import { StageAutofix } from "./StageAutofix";
import { StageGate } from "./StageGate";
import { StageGeneral, StageLimits } from "./StageGeneral";
import { StageMustKnow } from "./StageMustKnow";
import { StageOutput } from "./StageOutput";
import { StageRemind } from "./StageRemind";
import { StageSourcesField } from "./StageSourcesField";
import { StageStepFields } from "./StageStepFields";
import { StageWait } from "./StageWait";
import type { StageFormProps } from "./stage-form-props";

export type { StageFormProps } from "./stage-form-props";

export function StageForm(p: StageFormProps) {
  const { t } = useTranslation();
  const { stage, index, errors, readOnly, onChange } = p;
  return (
    <section
      aria-label={t("process.admin.editor.stage.aria", { n: index + 1, name: stage.name })}
      className="space-y-4 px-1"
    >
      <StageGeneral {...p} />
      <StageStepFields {...p} />
      {isWait(stage) ? (
        <StageWait {...p} />
      ) : (
        <>
          <StageOutput
            stage={stage}
            index={index}
            errors={errors}
            readOnly={readOnly}
            onChange={onChange}
          />
          {isApply(stage) ? (
            <StageApply {...p} />
          ) : (
            <>
              <StageSourcesField {...p} />
              <StageAutofix {...p} />
              <StageGate {...p} />
              <StageRemind {...p} />
            </>
          )}
          <StageAnswerer {...p} />
          <StageLimits {...p} />
          {isApply(stage) ? null : <StageMustKnow {...p} />}
        </>
      )}
      <StageActions {...p} />
    </section>
  );
}
