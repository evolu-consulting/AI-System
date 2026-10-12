// ADM-FR-66 · P-a F5: phần chung của giai đoạn — tên, mã, người làm, hướng dẫn; và hạn/ngân sách token.
import { useTranslation } from "react-i18next";
import { withCurrent } from "../../hooks/use-editor-refs";
import { SelectField, TextField } from "./Fields";
import type { StageFormProps } from "./stage-form-props";

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
    [...refs.agents, ...refs.teams],
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
        error={e("executor")}
        options={executors}
        onChange={(v) => onChange({ executor: v })}
      />
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
      <TextField
        id={`${stage.uid}-budget`}
        label={t("process.admin.editor.stage.budget")}
        type="number"
        value={stage.budget}
        error={e("token_budget")}
        readOnly={readOnly}
        onChange={(v) => onChange({ budget: v })}
      />
    </div>
  );
}
