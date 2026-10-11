// ADM-FR-69 · HUB-FR-125 · P-b FS-8a: "Điều phải biết trước khi làm" của giai đoạn (≤ 10 mục, ≤ 200 ký tự, mỗi dòng một mục).
import { useTranslation } from "react-i18next";
import type { DraftErrors, StageDraft } from "../../lib/def-form";
import { TextField } from "./Fields";

type Props = {
  stage: StageDraft;
  index: number;
  errors: DraftErrors;
  readOnly: boolean;
  onChange: (patch: Partial<StageDraft>) => void;
};

export function StageMustKnow({ stage, index, errors, readOnly, onChange }: Props) {
  const { t } = useTranslation();
  const err = errors[`stages.${index}.must_know`];
  return (
    <TextField
      id={`${stage.uid}-mustknow`}
      label={t("process.admin.editor.mustKnow.label")}
      description={t("process.admin.editor.mustKnow.hint")}
      value={stage.mustKnow}
      multiline
      rows={3}
      error={err ? t(err) : undefined}
      readOnly={readOnly}
      onChange={(v) => onChange({ mustKnow: v })}
    />
  );
}
