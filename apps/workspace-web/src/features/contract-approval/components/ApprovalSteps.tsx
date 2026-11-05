// CR-118 · cr118-flow-web · renderer của khe `contracts.approval` cho FlowPanel: dòng review/dify = dòng thời gian cũ (cùng chữ, cùng
// data-testid/data-status), esign = `EsignStepRow` cũ. Hai loại này thay renderer mặc định của registry (`StepOverrides`).
import type { ContractApproval } from "@ai/contracts/pack-contracts";
import { useTranslation } from "react-i18next";
import type { StepOverrides, StepProps } from "~/platform/flow";
import { hoursLeft, skipReason, type TimelineRow } from "../lib/engine-card";
import { rowOfFlowStep } from "../lib/flow-view";
import { EsignStepRow } from "./EsignStepRow";

type Esign = NonNullable<ContractApproval["esign"]>;

const DOT: Record<TimelineRow["status"], string> = {
  pending: "border-rule bg-transparent",
  open: "border-act bg-act",
  passed: "border-ok bg-ok",
  skipped: "border-rule bg-sunk",
  returned: "border-soon bg-soon",
  rejected: "border-late bg-late",
  running: "border-act bg-act-soft animate-pulse",
  failed: "border-late bg-late",
};

function When({ r, now }: { r: TimelineRow; now: number }) {
  const { t } = useTranslation();
  if (!r.due) return null;
  const late = r.due.flag === "overdue";
  const h = hoursLeft(r.due.at, now);
  return (
    <span
      className={late ? "font-semibold text-late" : "text-dim"}
      data-approval-due={r.due.flag ?? "ok"}
    >
      {new Date(r.due.at).toLocaleString()}
      {r.status === "open" &&
        ` · ${t(late ? "contracts.approval.engine.overdue" : "contracts.approval.engine.left", { n: Math.abs(h) })}`}
      {r.due.flag === "escalated" &&
        ` · ${t("contracts.approval.engine.escalated", { group: r.escalatedTo ?? "" })}`}
    </span>
  );
}

export function Row({ r, now }: { r: TimelineRow; now: number }) {
  const { t } = useTranslation();
  return (
    <li
      data-testid={`approval-step-${r.idx}`}
      data-status={r.status}
      className={`flex gap-3 border-b border-rule-soft py-2 last:border-b-0 ${r.skipWhen ? "opacity-60" : ""}`}
    >
      <span
        aria-hidden="true"
        className={`mt-1.5 h-3 w-3 shrink-0 rounded-full border ${DOT[r.status]}`}
      />
      <div className="min-w-0 flex-1 text-sm">
        <div className="flex flex-wrap items-center gap-x-2">
          <b>{r.name}</b>
          {r.skipWhen ? (
            <span className="text-caption text-dim" data-approval-skip="will">
              {t("contracts.approval.engine.willSkip", {
                reason: r.skipWhen
                  .map((c) => {
                    const x = skipReason(c);
                    return t(`contracts.approval.engine.skipReason.${x.key}`, {
                      n: x.vars.n.toLocaleString("vi-VN"),
                    });
                  })
                  .join(", "),
              })}
            </span>
          ) : (
            <span className="text-caption text-dim">
              {t(`contracts.approval.engine.status.${r.status}`)}
            </span>
          )}
          {r.group ? <span className="text-caption text-dim">· {r.group}</span> : null}
          {r.headOnly ? (
            <span className="text-caption text-dim">
              · {t("contracts.approval.engine.headOnly")}
            </span>
          ) : null}
          {r.ownerOverride ? (
            <span
              className="rounded-full bg-act-soft px-2 py-0.5 text-caption font-semibold text-act"
              data-testid="approval-owner-override"
            >
              {t("contracts.approval.engine.ownerOverride")}
            </span>
          ) : null}
          {r.overdue ? (
            <span
              className="rounded-full px-2 py-0.5 text-caption font-semibold text-late"
              data-testid="approval-overdue"
            >
              {t("contracts.approval.engine.overdueBadge")}
            </span>
          ) : null}
          {r.escalatedTo ? (
            <span className="text-caption text-dim" data-testid="approval-escalated-to">
              {t("contracts.approval.engine.escalatedTo", { group: r.escalatedTo })}
            </span>
          ) : null}
        </div>
        <div className="text-caption">
          <When r={r} now={now} />
        </div>
        {r.decidedBy && (
          <div className="text-caption text-dim">
            {t("contracts.approval.engine.decidedBy", { name: r.decidedBy })}
            {r.decidedAt ? ` · ${new Date(r.decidedAt).toLocaleString()}` : ""}
          </div>
        )}
        {r.feedback && <p className="mt-1 whitespace-pre-line text-caption">“{r.feedback}”</p>}
      </div>
    </li>
  );
}

/** review/dify ⇒ dòng thời gian cũ. */
function ReviewStep({ step, ctx }: StepProps<"review"> | StepProps<"dify">) {
  return <Row r={rowOfFlowStep(step, ctx.view.steps.indexOf(step))} now={ctx.now} />;
}

/** esign ⇒ `EsignStepRow` cũ (dựng lại `esign` của thẻ từ bước; "Gửi lại" theo id HĐ = `ctx.refId`). */
function EsignStep({ step, ctx }: StepProps<"esign">) {
  const e = step.esign;
  return (
    <EsignStepRow
      id={ctx.refId}
      e={{
        key: step.key,
        name: step.name,
        status: e.provider_status,
        reason: e.reason as Esign["reason"],
        can_resend: e.can_resend,
        due_at: step.due_at,
        overdue: step.overdue,
        reminded_at: e.reminded_at,
      }}
    />
  );
}

export const APPROVAL_OVERRIDES: StepOverrides = {
  review: ReviewStep,
  dify: ReviewStep,
  esign: EsignStep,
};
