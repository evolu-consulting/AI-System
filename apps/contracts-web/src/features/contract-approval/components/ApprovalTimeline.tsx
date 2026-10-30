// contract-flow S4: dòng thời gian các bước duyệt của HĐ chạy trên engine — tên bước, phòng, trạng thái, hạn / quá hạn / chuyển cấp,
// người quyết + lúc, góp ý. Người có quyền sửa (platform_admin) có lối vào "Chỉnh quy trình duyệt" (sang ai-admin, CR-105 L4).
import type { ContractApproval } from "@ai/contracts";
import { useTranslation } from "react-i18next";
import { FlowEditorLink } from "~/features/settings/components/FlowEditorLink";
import { useGroups } from "../hooks/use-groups";
import { hoursLeft, type TimelineRow, timelineRows } from "../lib/engine-card";
import { EsignStepRow } from "./EsignStepRow";

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

function Row({ r, now }: { r: TimelineRow; now: number }) {
  const { t } = useTranslation();
  return (
    <li
      data-testid={`approval-step-${r.idx}`}
      data-status={r.status}
      className="flex gap-3 border-b border-rule-soft py-2 last:border-b-0"
    >
      <span
        aria-hidden="true"
        className={`mt-1.5 h-3 w-3 shrink-0 rounded-full border ${DOT[r.status]}`}
      />
      <div className="min-w-0 flex-1 text-sm">
        <div className="flex flex-wrap items-center gap-x-2">
          <b>{r.name}</b>
          <span className="text-caption text-dim">
            {t(`contracts.approval.engine.status.${r.status}`)}
          </span>
          {r.group ? <span className="text-caption text-dim">· {r.group}</span> : null}
          {r.headOnly ? (
            <span className="text-caption text-dim">
              · {t("contracts.approval.engine.headOnly")}
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

export function ApprovalTimeline({ id, a }: { id: string; a: ContractApproval }) {
  const { t } = useTranslation();
  const groups = useGroups(a.mode === "engine");
  if (a.mode !== "engine" || !a.steps?.length) return null;
  const esign = a.esign ?? null;
  const now = Date.now();
  const rows = timelineRows(a.steps, groups.data ?? [], now);
  return (
    <section data-approval="timeline" className="mb-4 rounded-xl border border-line p-4">
      <div className="mb-1 flex items-center gap-3">
        <h3 className="text-sm font-semibold">{t("contracts.approval.engine.title")}</h3>
        <FlowEditorLink
          testId="approval-edit-flow"
          className="ml-auto text-caption text-act underline"
        />
      </div>
      <ol>
        {rows.map((r) => (
          <Row key={r.idx} r={r} now={now} />
        ))}
        {esign && <EsignStepRow id={id} e={esign} />}
      </ol>
    </section>
  );
}
