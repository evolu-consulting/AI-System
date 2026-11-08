// CR-123 · FR-13 (ux-audit #11): node Duyệt trong trình sửa quy trình mặc định chỉ hiện "Ai duyệt" (chọn phòng ban từ danh sách,
// không gõ mã) + "Hạn trả lời"; chuyển cấp, loại người bắt đầu… nằm ở "Nâng cao" (StageRemind).
import { useTranslation } from "react-i18next";
import { remindIssueKey } from "../../domain/error-keys";
import { REMIND_EVERY_H } from "../../domain/limits";
import { remindIssue } from "../../domain/remind-rules";
import { withCurrent } from "../../hooks/use-editor-refs";
import { SelectField, TextField } from "./Fields";
import type { StageFormProps } from "./stage-form-props";

const K = "process.admin.editor.stage.";

export function StageApproveBasics(p: StageFormProps) {
  const { t } = useTranslation();
  const { stage, index, errors, readOnly, refs, onChange } = p;
  const gErr = errors[`stages.${index}.after.group_id`];
  const rErr = remindIssue(stage.remind)
    ? remindIssueKey()
    : errors[`stages.${index}.after.remind_every_h`];
  return (
    <div className="space-y-3" data-testid="stage-approve-basics">
      <SelectField
        id={`${stage.uid}-group`}
        label={t(`${K}approver`)}
        value={stage.groupId}
        readOnly={readOnly}
        alert
        placeholder={t(`${K}approverPh`)}
        error={gErr ? t(gErr) : undefined}
        options={withCurrent(
          refs.approverGroups ?? refs.groups,
          stage.groupId,
          t("process.admin.editor.gone"),
        )}
        onChange={(v) => onChange({ groupId: v, after: "review" })}
      />
      <TextField
        id={`${stage.uid}-remind`}
        label={t(`${K}answerBy`)}
        type="number"
        min={REMIND_EVERY_H.min}
        max={REMIND_EVERY_H.max}
        value={stage.remind}
        readOnly={readOnly}
        description={t(`${K}answerByHint`)}
        alert
        error={rErr ? t(rErr) : undefined}
        onChange={(v) => onChange({ remind: v })}
      />
    </div>
  );
}
