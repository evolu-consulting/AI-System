// ADM-FR-66 · P-a F5: "Người trả lời" của giai đoạn (người bắt đầu / Group / người dùng).
import { useTranslation } from "react-i18next";
import { withCurrent } from "../../hooks/use-editor-refs";
import type { StageDraft } from "../../lib/def-form";
import { SelectField } from "./Fields";
import type { StageFormProps } from "./stage-form-props";

export function StageAnswerer({ stage, index, errors, readOnly, refs, onChange }: StageFormProps) {
  const { t } = useTranslation();
  const gone = t("process.admin.editor.gone");
  const err = errors[`stages.${index}.answerer`];
  const kinds = (["starter", "group", "user"] as const).map((k) => ({
    value: k,
    label: t(`process.admin.editor.stage.${k}`),
  }));
  const list = stage.answerer === "group" ? refs.groups : refs.users;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <SelectField
        id={`${stage.uid}-answerer`}
        label={t("process.admin.editor.stage.answerer")}
        value={stage.answerer}
        readOnly={readOnly}
        options={kinds}
        onChange={(v) => onChange({ answerer: v as StageDraft["answerer"], answererId: "" })}
      />
      {stage.answerer === "starter" ? null : (
        <SelectField
          id={`${stage.uid}-answerer-id`}
          label={t(`process.admin.editor.stage.${stage.answerer}`)}
          value={stage.answererId}
          readOnly={readOnly}
          error={err ? t(err) : undefined}
          options={withCurrent(list, stage.answererId, gone)}
          onChange={(v) => onChange({ answererId: v })}
        />
      )}
    </div>
  );
}
