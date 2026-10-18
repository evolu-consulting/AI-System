// ADM-FR-66 · P-a F5: phần chung của giai đoạn — tên, mã, người làm, hướng dẫn; và hạn/ngân sách token.
import { useTranslation } from "react-i18next";
import { withCurrent } from "../../hooks/use-editor-refs";
import { APPLY_EXECUTOR, APPLY_PATCH, applyKeyOnly, isApply } from "../../lib/apply-form";
import type { StageDraft } from "../../lib/draft-types";
import { isTool, TOOL_EXECUTOR, TOOL_PATCH } from "../../lib/tool-form";
import { isWait, WAIT_EXECUTOR, WAIT_PATCH } from "../../lib/wait-form";
import { SelectField, TextField } from "./Fields";
import type { StageFormProps } from "./stage-form-props";

const PATCH_OF: Record<string, Partial<StageDraft>> = {
  [APPLY_EXECUTOR]: APPLY_PATCH,
  [WAIT_EXECUTOR]: WAIT_PATCH,
  [TOOL_EXECUTOR]: TOOL_PATCH,
};
/** Lỗi `executor` đã hiện ở khối riêng (Áp bản sửa / Gọi tool) ⇒ không in lại dưới ô "Người thực hiện". */
const ownedElsewhere = (k: string | undefined): boolean =>
  applyKeyOnly(k) || k?.startsWith("process.admin.editor.stage.tool.err.") === true;

function useStageError(p: StageFormProps) {
  const { t } = useTranslation();
  return (f: string): string | undefined => {
    const k = p.errors[`stages.${p.index}.${f}`];
    return k ? t(k) : undefined;
  };
}

export function StageGeneral(p: StageFormProps) {
  const { t } = useTranslation();
  const { stage, readOnly, refs, onChange } = p;
  const e = useStageError(p);
  const executors = withCurrent(
    [
      ...refs.agents,
      ...refs.teams,
      { value: APPLY_EXECUTOR, label: t("process.admin.apply.kind") },
      { value: WAIT_EXECUTOR, label: t("process.admin.editor.stage.kind.wait") },
      { value: TOOL_EXECUTOR, label: t("process.admin.editor.stage.kind.tool") },
    ],
    stage.executor,
    t("process.admin.editor.gone"),
  );
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          id={`${stage.uid}-name`}
          label={t("process.admin.editor.stage.name")}
          value={stage.name}
          error={e("name")}
          readOnly={readOnly}
          onChange={(v) => onChange({ name: v })}
        />
        <TextField
          id={`${stage.uid}-key`}
          label={t("process.admin.editor.stage.key")}
          value={stage.key}
          error={e("key")}
          readOnly={readOnly}
          mono
          onChange={(v) => onChange({ key: v, keyAuto: false })}
        />
      </div>
      <SelectField
        id={`${stage.uid}-exec`}
        label={t("process.admin.editor.stage.executor")}
        value={stage.executor}
        readOnly={readOnly}
        error={ownedElsewhere(p.errors[`stages.${p.index}.executor`]) ? undefined : e("executor")}
        options={executors}
        onChange={(v) => onChange(PATCH_OF[v] ?? { executor: v })}
      />
      {isApply(stage) || isWait(stage) || isTool(stage) ? null : (
        <TextField
          id={`${stage.uid}-instr`}
          label={t("process.admin.editor.stage.instruction")}
          value={stage.instruction}
          error={e("instruction")}
          readOnly={readOnly}
          multiline
          rows={4}
          onChange={(v) => onChange({ instruction: v })}
        />
      )}
    </>
  );
}

export function StageLimits(p: StageFormProps) {
  const { t } = useTranslation();
  const { stage, readOnly, onChange } = p;
  const e = useStageError(p);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <TextField
        id={`${stage.uid}-timeout`}
        label={t("process.admin.editor.stage.timeout")}
        type="number"
        value={stage.timeout}
        error={e("timeout_s")}
        readOnly={readOnly}
        onChange={(v) => onChange({ timeout: v })}
      />
      {isApply(stage) || isTool(stage) ? null : (
        <TextField
          id={`${stage.uid}-budget`}
          label={t("process.admin.editor.stage.budget")}
          type="number"
          value={stage.budget}
          error={e("token_budget")}
          readOnly={readOnly}
          onChange={(v) => onChange({ budget: v })}
        />
      )}
    </div>
  );
}
