// ADM-FR-66 · CR-056 · P-a F5 · P-b2 · P-d2: khung form một giai đoạn — `region "Giai đoạn n: <tên>"` (plan-frontend §1, e2e §2).
// Chi tiết từng phần ở StageGeneral/StageStepFields/StageGate/StageAnswerer/StageActions (tách — TECH-DEBT #136).
import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { isApply } from "../../lib/apply-form";
import { isIf } from "../../lib/if-form";
import { isSet } from "../../lib/set-form";
import { isTool } from "../../lib/tool-form";
import { isWait } from "../../lib/wait-form";
import { StageActions } from "./StageActions";
import { StageAnswerer } from "./StageAnswerer";
import { StageApply } from "./StageApply";
import { StageAutofix } from "./StageAutofix";
import { StageBranch } from "./StageBranch";
import { StageGate } from "./StageGate";
import { StageGeneral, StageLimits } from "./StageGeneral";
import { StageIfForm } from "./StageIf";
import { StageMustKnow } from "./StageMustKnow";
import { StageOutput } from "./StageOutput";
import { StageRemind } from "./StageRemind";
import { StageSet } from "./StageSet";
import { StageSourcesField } from "./StageSourcesField";
import { StageStepFields } from "./StageStepFields";
import { StageWait } from "./StageWait";
import type { StageFormProps } from "./stage-form-props";

export type { StageFormProps } from "./stage-form-props";

/** P-d2 · chỉ nạp khi chọn "Gọi tool" (plan-frontend-d2 §14). */
const StageTool = lazy(() => import("./StageTool"));

/** `stages.<i>.executor.values.<j>.key|from` → `<j>.key|from` (cho StageSet). */
function setErrors(
  errors: StageFormProps["errors"],
  index: number,
  t: (k: string) => string,
): Record<string, string> {
  const pre = `stages.${index}.executor.values.`;
  return Object.fromEntries(
    Object.entries(errors)
      .filter(([k]) => k.startsWith(pre))
      .map(([k, v]) => [k.slice(pre.length), t(v)]),
  );
}

function Body(p: StageFormProps) {
  const { t } = useTranslation();
  const { stage, index, errors, readOnly, onChange } = p;
  const set = isSet(stage);
  const tool = isTool(stage) || set; // `set` như `tool`: không nguồn/tự-sửa/người trả lời/ghi nhớ (Hub ép khi lưu)
  const apply = isApply(stage);
  return (
    <>
      {set ? (
        <StageSet
          id={stage.uid}
          rows={stage.set.rows}
          fields={stage.fields}
          inputs={(p.defInputs ?? []).map((i) => ({
            key: i.key,
            label: i.label || i.key,
            type: i.type,
          }))}
          readOnly={readOnly}
          errors={setErrors(errors, index, t)}
          onChange={(rows) => onChange({ set: { rows } })}
        />
      ) : null}
      {isTool(stage) ? (
        <Suspense fallback={null}>
          <StageTool {...p} />
        </Suspense>
      ) : (
        <StageOutput
          stage={stage}
          index={index}
          errors={errors}
          readOnly={readOnly}
          onChange={onChange}
        />
      )}
      {apply ? (
        <StageApply {...p} />
      ) : (
        <>
          {tool ? null : (
            <>
              <StageSourcesField {...p} />
              <StageAutofix {...p} />
            </>
          )}
          <StageGate {...p} />
          <StageRemind {...p} />
          <StageBranch {...p} />
        </>
      )}
      {tool ? null : <StageAnswerer {...p} />}
      <StageLimits {...p} />
      {apply || tool ? null : <StageMustKnow {...p} />}
    </>
  );
}

export function StageForm(p: StageFormProps) {
  const { t } = useTranslation();
  const { stage, index } = p;
  return (
    <section
      aria-label={t("process.admin.editor.stage.aria", { n: index + 1, name: stage.name })}
      className="space-y-4 px-1"
    >
      <StageGeneral {...p} />
      <StageStepFields {...p} />
      {isWait(stage) ? (
        <StageWait {...p} />
      ) : isIf(stage) ? (
        <StageIfForm {...p} />
      ) : (
        <Body {...p} />
      )}
      <StageActions {...p} />
    </section>
  );
}
