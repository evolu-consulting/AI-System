// CR-127 · U2e · panel node «Xác nhận mốc»: Ai xác nhận (phòng hoặc người; trống = người phụ trách hợp đồng) · Cần · Hạn · Quá hạn
// chuyển cho · Nhắc mỗi. Lưu vào khối `after` kiểu review của bước (engine L1 đọc ở đó).
import { useTranslation } from "react-i18next";
import { escalateIssueKey, remindIssueKey } from "../../domain/error-keys";
import { ESCALATE_AFTER_H, REMIND_EVERY_H } from "../../domain/limits";
import { escalateIssues, remindIssue } from "../../domain/remind-rules";
import { withCurrent } from "../../hooks/use-editor-refs";
import { useApproverField } from "../../hooks/use-group-key-options";
import { dueToValueOf, withDue, withDueTo } from "../../lib/approve-panel";
import type { ReviewExtra } from "../../lib/draft-types";
import { milestoneWhoPatch, needOf, whoValueOf } from "../../lib/milestone-panel";
import { useFlowCtx } from "../flow/flow-ctx";
import { SelectField, TextField } from "./Fields";
import type { StageFormProps } from "./stage-form-props";

const K = "process.admin.editor.stage.";
const NEEDS = ["one", "head", "all"] as const;
const OWNER = "owner"; // giá trị đại diện "người phụ trách hợp đồng" (không lưu — lưu là để trống phòng + người)

export function StageMilestone(p: StageFormProps) {
  const { t } = useTranslation();
  const { stage, index, errors, readOnly, refs, onChange } = p;
  const who = useApproverField(stage, refs, t("process.admin.editor.gone"));
  const flow = useFlowCtx();
  const lib = !!flow && !flow.tenantId;
  const whoOptions = [
    { value: OWNER, label: t(`${K}milestone.owner`) },
    ...who.options,
    ...(lib ? [] : refs.users.map((u) => ({ value: `u:${u.value}`, label: u.label }))),
  ];
  const picked = whoValueOf(stage, who.value);
  const esc = stage.escalate;
  const live = escalateIssues(esc, stage.groupId);
  const afterErr = esc.on && live.afterH ? escalateIssueKey("afterH") : undefined;
  const dueTo = dueToValueOf(esc);
  const gone = t("process.admin.editor.gone");
  const dueOptions = [
    ...withCurrent(
      refs.groups.map((g) => ({ value: `g:${g.value}`, label: g.label })),
      dueTo.startsWith("g:") ? dueTo : "",
      gone,
    ),
    ...refs.users.map((u) => ({ value: `u:${u.value}`, label: u.label })),
  ];
  const rErr = remindIssue(stage.remind)
    ? remindIssueKey()
    : errors[`stages.${index}.after.remind_every_h`];
  const toErr = errors[`stages.${index}.after.escalate.group_id`];
  return (
    <div className="space-y-3" data-testid="stage-milestone">
      <SelectField
        id={`${stage.uid}-ms-who`}
        label={t(`${K}milestone.who`)}
        value={picked === "" ? OWNER : picked}
        readOnly={readOnly}
        description={t(`${K}milestone.whoHint`)}
        options={whoOptions}
        onChange={(v) => onChange(milestoneWhoPatch(stage, v === OWNER ? "" : v, who.patch))}
      />
      <SelectField
        id={`${stage.uid}-ms-need`}
        label={t(`${K}need`)}
        value={needOf(stage)}
        readOnly={readOnly}
        options={NEEDS.map((n) => ({ value: n, label: t(`${K}need_${n}`) }))}
        onChange={(v) =>
          onChange({ after: "review", review: { ...stage.review, need: v as ReviewExtra["need"] } })
        }
      />
      <TextField
        id={`${stage.uid}-ms-due`}
        label={t(`${K}due`)}
        type="number"
        min={ESCALATE_AFTER_H.min}
        max={ESCALATE_AFTER_H.max}
        value={esc.on ? esc.afterH : ""}
        readOnly={readOnly}
        description={t(`${K}dueHint`, ESCALATE_AFTER_H)}
        alert
        error={afterErr ? t(afterErr, ESCALATE_AFTER_H) : undefined}
        onChange={(v) => onChange({ after: "review", escalate: withDue(esc, v) })}
      />
      {esc.on ? (
        <SelectField
          id={`${stage.uid}-ms-due-to`}
          label={t(`${K}dueTo`)}
          value={dueTo}
          readOnly={readOnly}
          alert
          placeholder={t(`${K}dueToPh`)}
          error={toErr ? t(toErr) : undefined}
          options={dueOptions}
          onChange={(v) => onChange({ after: "review", escalate: withDueTo(esc, v) })}
        />
      ) : null}
      <TextField
        id={`${stage.uid}-ms-remind`}
        label={t(`${K}remindEvery`)}
        type="number"
        min={REMIND_EVERY_H.min}
        max={REMIND_EVERY_H.max}
        value={stage.remind}
        readOnly={readOnly}
        description={t(`${K}remindHint`)}
        alert
        error={rErr ? t(rErr, REMIND_EVERY_H) : undefined}
        onChange={(v) => onChange({ after: "review", remind: v })}
      />
    </div>
  );
}
