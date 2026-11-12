// CR-125 · cr125-request-steps · `<RunStepActions view/>`: MỘT component cho «việc của người xem ở lượt chạy» dùng chung mọi trang có
// `FlowView` — các bước (renderer theo loại, trong đó bước «Điền thông tin» = `FormStep` + «Gửi») và hành động của task đang mở
// (Duyệt / Trả lại / Từ chối theo `FlowTask.actions`, lý do bắt buộc khi hành động đòi `feedback`). Không biết gói nào: chỉ gọi hai
// lệnh do trang cấp (`onSubmitForm`, `onDecide`) — trang HĐ cấp theo khe flow, trang yêu cầu cấp theo `/review-tasks/:id/*`.
// CR-127 · U4: dải nhận việc (`ClaimBar`) + ô bằng chứng (`EvidenceInput`) khi trang bật `evidence`.
import type { EvidenceInput as EvidenceBody } from "@ai/contracts/chat";
import type { FlowActionDef, FlowFormValues, FlowTask, FlowView } from "@ai/contracts/flow";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { claimView } from "../lib/claim";
import { type EvidenceRule, evidenceRuleOf } from "../lib/evidence";
import { ClaimBar } from "./ClaimBar";
import { EvidenceAsk } from "./EvidenceAsk";
import { FlowPanelBody } from "./FlowPanel";
import type { Person } from "./ReassignBox";
import type { StepOverrides } from "./types";

export type RunStepActionsProps = {
  /** Khe/ref chỉ để gắn thuộc tính (renderer bước dùng `ctx.slot/refId`). */
  slot: string;
  refId: string;
  view: FlowView;
  onSubmitForm: (taskId: string, values: FlowFormValues) => Promise<void>;
  onDecide: (
    taskId: string,
    action: string,
    feedback?: string,
    evidence?: EvidenceBody,
  ) => Promise<void>;
  /** CR-127 · trang chuyển `evidence` tới server ⇒ hành động có ô bằng chứng hiện ý kiến + chữ ký + tệp (thay vì chỉ lý do). */
  evidence?: boolean | undefined;
  /** CR-127 · sau «Nhận việc» / «Trả về nhóm»: tải lại view. */
  onClaimChanged?: (() => void) | undefined;
  /** CR-127 · U4b-1 · người có thể nhận việc chuyển giao (trang cấp) ⇒ hiện «Chuyển cho…». */
  people?: readonly Person[] | undefined;
  overrides?: StepOverrides | undefined;
  frame?: ((steps: ReactNode, view: FlowView) => ReactNode) | undefined;
  /** Đang gửi quyết định (khoá nút). */
  busy?: boolean | undefined;
  error?: boolean | undefined;
};

const BTN: Record<FlowActionDef["style"], string> = {
  primary: "btn btn-primary",
  default: "btn",
  danger: "btn border border-late bg-panel text-late hover:bg-late-bg",
};

/** Task cần nút hành động: task `review` của người xem (task `form` gửi ngay trên thẻ bước). */
export const decisionTaskOf = (view: FlowView): FlowTask | null =>
  view.tasks.find((t) => t.kind !== "form" && t.actions.length > 0) ?? null;

const needsReason = (a: FlowActionDef): boolean =>
  a.input.kind === "feedback" && a.input.required === true;

export function RunStepActions(p: RunStepActionsProps) {
  const { t } = useTranslation();
  const [asking, setAsking] = useState<FlowActionDef | null>(null);
  const [reason, setReason] = useState("");
  const task = decisionTaskOf(p.view);
  const cv = task ? claimView(task) : null;
  const ruleOf = (a: FlowActionDef): EvidenceRule | null =>
    p.evidence === true ? evidenceRuleOf(a.input, task?.evidence_mode, a.key) : null;
  const decide = async (a: FlowActionDef, feedback?: string, evidence?: EvidenceBody) => {
    if (!task) return;
    await p.onDecide(task.task_id, a.key, feedback, evidence);
    setAsking(null);
    setReason("");
  };
  // Trả lại / Từ chối: ý kiến cũng là lý do bắt buộc của hành động (`FEEDBACK_REQUIRED`).
  const sendEvidence = (a: FlowActionDef, body: EvidenceBody) =>
    void decide(a, a.style === "primary" ? undefined : body.note, body);
  const askingRule = asking ? ruleOf(asking) : null;
  return (
    <div data-flow="run-actions">
      <FlowPanelBody
        state={{ status: "ready", view: p.view }}
        slot={p.slot}
        refId={p.refId}
        overrides={p.overrides}
        frame={p.frame}
        submitForm={(taskId, values) => p.onSubmitForm(taskId, values)}
      />
      {task && (
        <div data-testid="request-task" className="mt-3">
          <ClaimBar
            taskId={task.task_id}
            info={task}
            people={p.people}
            onChanged={() => p.onClaimChanged?.()}
          />
          {asking && askingRule ? (
            <EvidenceAsk
              action={asking}
              rule={askingRule}
              busy={p.busy === true}
              onSend={(b) => sendEvidence(asking, b)}
              onCancel={() => setAsking(null)}
            />
          ) : asking ? (
            <div className="flex flex-col gap-2">
              <label htmlFor={`run-reason-${p.refId}`} className="text-sm">
                {t("contracts.requests.reason", { action: asking.label })}
              </label>
              <textarea
                id={`run-reason-${p.refId}`}
                rows={3}
                className="w-full rounded-md border border-rule bg-panel px-3 py-2 text-sm"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={p.busy === true || reason.trim() === ""}
                  data-testid={`request-${asking.key}-confirm`}
                  onClick={() => void decide(asking, reason.trim())}
                >
                  {asking.label}
                </button>
                <button
                  type="button"
                  className="btn btn-quiet btn-sm"
                  onClick={() => setAsking(null)}
                >
                  {t("contracts.requests.cancel")}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {task.actions.map((a) => (
                <button
                  key={a.key}
                  type="button"
                  className={BTN[a.style]}
                  disabled={p.busy === true || cv?.decideLocked != null}
                  title={
                    cv?.decideLocked
                      ? t(`contracts.work.u4.claim.locked.${cv.decideLocked}`)
                      : undefined
                  }
                  data-testid={`request-${a.key}`}
                  onClick={() => (ruleOf(a) || needsReason(a) ? setAsking(a) : void decide(a))}
                >
                  {a.label}
                </button>
              ))}
            </div>
          )}
          {p.error && (
            <p role="alert" className="mt-2 text-sm text-late">
              {t("contracts.requests.decideError")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
