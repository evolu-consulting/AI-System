// CR-123 · FR-13 (ux-audit #11): node Duyệt trong trình sửa quy trình mặc định chỉ hiện "Ai duyệt" (chọn phòng ban từ danh sách,
// không gõ mã) + "Hạn trả lời"; chuyển cấp, loại người bắt đầu… nằm ở "Nâng cao" (StageRemind).
import { useTranslation } from "react-i18next";
import { escalateIssueKey, remindIssueKey } from "../../domain/error-keys";
import { ESCALATE_AFTER_H, REMIND_EVERY_H } from "../../domain/limits";
import { escalateIssues, remindIssue } from "../../domain/remind-rules";
import { withCurrent } from "../../hooks/use-editor-refs";
import { useApproverField } from "../../hooks/use-group-key-options";
import {
  dueToValueOf,
  needOf,
  STARTER_HEAD,
  whoPatch,
  whoValueOf,
  withDue,
  withDueTo,
} from "../../lib/approve-panel";
import type { ReviewExtra } from "../../lib/draft-types";
import { useFlowCtx } from "../flow/flow-ctx";
import { SelectField, TextField } from "./Fields";
import { StageApproveParallel } from "./StageApproveParallel";
import type { StageFormProps } from "./stage-form-props";

const K = "process.admin.editor.stage.";
const NEEDS = ["one", "head", "all"] as const;
const EVIDENCE = ["opinion", "opinion_plus"] as const;

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: CR-127 · U2 — dựng form nhiều ô, tách ở đợt dọn sau
export function StageApproveBasics(p: StageFormProps) {
  const { t } = useTranslation();
  const { stage, index, errors, readOnly, refs, onChange } = p;
  const who = useApproverField(stage, refs, t("process.admin.editor.gone"));
  // CR-127 · Z2 · công ty chọn phòng HOẶC người (server nhận `approver_user_id` không phòng); mẫu Thư viện chỉ chọn phòng theo mã.
  const flow = useFlowCtx();
  const lib = !!flow && !flow.tenantId;
  const head = { value: STARTER_HEAD, label: t(`${K}approverStarterHead`) };
  const whoOptions = [
    head,
    ...(lib
      ? who.options
      : [...who.options, ...refs.users.map((u) => ({ value: `u:${u.value}`, label: u.label }))]),
  ];
  const whoValue = whoValueOf(stage, who.value);
  const pickWho = (v: string) => onChange(whoPatch(stage, v, who.patch));
  const gErr = errors[`stages.${index}.after.group_id`];
  const rErr = remindIssue(stage.remind)
    ? remindIssueKey()
    : errors[`stages.${index}.after.remind_every_h`];
  const esc = stage.escalate;
  const need = needOf(stage);
  const setReview = (p: Partial<ReviewExtra>) => onChange({ review: { ...stage.review, ...p } });
  const live = escalateIssues(esc, stage.groupId);
  const afterErr = esc.on && live.afterH ? escalateIssueKey("afterH") : undefined;
  const dueTo = dueToValueOf(esc);
  const gone = t("process.admin.editor.gone");
  const dueOptions = [
    ...withCurrent(
      refs.groups
        .filter((g) => g.value !== stage.groupId)
        .map((g) => ({ value: `g:${g.value}`, label: g.label })),
      dueTo.startsWith("g:") ? dueTo : "",
      gone,
    ),
    ...refs.users.map((u) => ({ value: `u:${u.value}`, label: u.label })),
  ];
  const toErr =
    live.groupId === "same"
      ? escalateIssueKey("groupId")
      : (errors[`stages.${index}.after.escalate.group_id`] ??
        errors[`stages.${index}.after.escalate`]);
  return (
    <div className="space-y-3" data-testid="stage-approve-basics">
      {stage.parallel ? null : (
        <SelectField
          id={`${stage.uid}-group`}
          label={t(`${K}approver`)}
          value={whoValue}
          readOnly={readOnly}
          alert
          placeholder={t(`${K}approverPh`)}
          description={whoValue === STARTER_HEAD ? t(`${K}approverStarterHeadHint`) : undefined}
          error={gErr ? t(gErr) : undefined}
          options={whoOptions}
          onChange={pickWho}
        />
      )}
      <StageApproveParallel {...p} />
      {/* CR-127 · U2 · spec §8.1: Cần · Hạn · Quá hạn chuyển cho (phòng hoặc người) · Bằng chứng · Nhắc */}
      <SelectField
        id={`${stage.uid}-need`}
        label={t(`${K}need`)}
        value={need}
        readOnly={readOnly}
        options={NEEDS.map((n) => ({ value: n, label: t(`${K}need_${n}`) }))}
        onChange={(v) => setReview({ need: v as ReviewExtra["need"] })}
      />
      <TextField
        id={`${stage.uid}-due`}
        label={t(`${K}due`)}
        type="number"
        min={ESCALATE_AFTER_H.min}
        max={ESCALATE_AFTER_H.max}
        value={esc.on ? esc.afterH : ""}
        readOnly={readOnly}
        description={t(`${K}dueHint`, ESCALATE_AFTER_H)}
        alert
        error={afterErr ? t(afterErr, ESCALATE_AFTER_H) : undefined}
        onChange={(v) => onChange({ escalate: withDue(esc, v) })}
      />
      {esc.on ? (
        <SelectField
          id={`${stage.uid}-due-to`}
          label={t(`${K}dueTo`)}
          value={dueTo}
          readOnly={readOnly}
          alert
          placeholder={t(`${K}dueToPh`)}
          error={toErr ? t(toErr) : undefined}
          options={dueOptions}
          onChange={(v) => onChange({ escalate: withDueTo(esc, v) })}
        />
      ) : null}
      <SelectField
        id={`${stage.uid}-evidence`}
        label={t(`${K}evidence`)}
        value={stage.review?.evidence ?? "opinion"}
        readOnly={readOnly}
        options={EVIDENCE.map((n) => ({ value: n, label: t(`${K}evidence_${n}`) }))}
        onChange={(v) => setReview({ evidence: v as ReviewExtra["evidence"] })}
      />
      <TextField
        id={`${stage.uid}-remind`}
        label={t(`${K}remindEvery`)}
        type="number"
        min={REMIND_EVERY_H.min}
        max={REMIND_EVERY_H.max}
        value={stage.remind}
        readOnly={readOnly}
        description={t(`${K}remindHint`)}
        alert
        error={rErr ? t(rErr, REMIND_EVERY_H) : undefined}
        onChange={(v) => onChange({ remind: v })}
      />
    </div>
  );
}
