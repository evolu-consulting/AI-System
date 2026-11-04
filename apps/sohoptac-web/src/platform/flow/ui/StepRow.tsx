// CR-118 · cr118-flow-web · dòng bước mặc định (review/dify/esign/wait/system) + `GenericStep` cho loại lạ của snapshot cũ.
// Chỉ đọc các trường nền của `FlowStepView` (tên, trạng thái, người nhận, hạn, người quyết, góp ý) — không giả định loại.
import type { FlowAssignee, FlowStepView } from "@ai/contracts/flow";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { AnyStepProps } from "./types";

const DOT: Record<FlowStepView["status"], string> = {
  pending: "border-rule bg-transparent",
  open: "border-act bg-act",
  running: "border-act bg-act-soft animate-pulse",
  passed: "border-ok bg-ok",
  skipped: "border-rule bg-sunk",
  returned: "border-soon bg-soon",
  rejected: "border-late bg-late",
  failed: "border-late bg-late",
  needs_decision: "border-late bg-late",
};
const dotOf = (status: string): string => DOT[status as FlowStepView["status"]] ?? DOT.pending;

function Assignee({ a }: { a: FlowAssignee | null }) {
  const { t } = useTranslation();
  if (!a) return null;
  const name = a.kind === "system" ? t("contracts.flowPanel.system") : a.label;
  if (!name) return null;
  return <span className="text-caption text-dim">· {name}</span>;
}

/** Khung một dòng bước; `children` = phần riêng của loại (form, nút…). */
export function StepFrame({
  step,
  now,
  children,
}: {
  step: FlowStepView;
  now: number;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const late = step.overdue || step.escalated;
  return (
    <li
      data-testid={`flow-step-${step.key}`}
      data-kind={step.kind}
      data-status={step.status}
      className="flex gap-3 border-b border-rule-soft py-2 last:border-b-0"
    >
      <span
        aria-hidden="true"
        className={`mt-1.5 h-3 w-3 shrink-0 rounded-full border ${dotOf(step.status)}`}
      />
      <div className="min-w-0 flex-1 text-sm">
        <div className="flex flex-wrap items-center gap-x-2">
          <b>{step.name}</b>
          <span className="text-caption text-dim">
            {t(`contracts.flowPanel.status.${step.status}`, { defaultValue: step.status })}
          </span>
          <Assignee a={step.assignee} />
          {step.overdue && (
            <span className="rounded-full px-2 py-0.5 text-caption font-semibold text-late">
              {t("contracts.flowPanel.overdue")}
            </span>
          )}
          {step.escalated_to && (
            <span className="text-caption text-dim">
              {t("contracts.flowPanel.escalatedTo", { name: step.escalated_to })}
            </span>
          )}
        </div>
        {step.due_at && (
          <div className={`text-caption ${late ? "font-semibold text-late" : "text-dim"}`}>
            {new Date(step.due_at).toLocaleString()}
            {step.status === "open"
              ? ` · ${t(step.overdue ? "contracts.flowPanel.late" : "contracts.flowPanel.left", {
                  n: Math.abs(Math.trunc((Date.parse(step.due_at) - now) / 3_600_000)),
                })}`
              : ""}
          </div>
        )}
        {step.decided_by && (
          <div className="text-caption text-dim">
            {t("contracts.flowPanel.decidedBy", { name: step.decided_by.name })}
            {step.decided_at ? ` · ${new Date(step.decided_at).toLocaleString()}` : ""}
          </div>
        )}
        {step.feedback && (
          <p className="mt-1 whitespace-pre-line text-caption">“{step.feedback}”</p>
        )}
        {children}
      </div>
    </li>
  );
}

/** Renderer mặc định của review/dify/esign/wait/system — một dòng bước. */
export default function DefaultStep({ step, ctx }: AnyStepProps) {
  return <StepFrame step={step} now={ctx.now} />;
}

/** Loại bước không có trong map (snapshot cũ): vẽ phần nền, không vỡ trang. */
export function GenericStep({ step, ctx }: AnyStepProps) {
  return <StepFrame step={step} now={ctx.now} />;
}
