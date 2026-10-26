// contract-flow S4 · "Chờ tôi duyệt" của Tổng quan: HĐ có bước duyệt (engine) đang chờ người xem — tên HĐ, bước, hạn, link sang HĐ.
// Chỉ hiện khi có việc (máy chủ chỉ trả `approvals` khi duyệt trên engine bật).
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Panel } from "~/components/shared/layout";
import { Tag } from "~/components/shared/tag";
import { useMyApprovals } from "../hooks/use-overview";
import { approvalRows } from "../lib/approvals";
import { BlockHead } from "./BlockHead";

export function ApprovalTasksBlock() {
  const { t } = useTranslation();
  const q = useMyApprovals();
  const rows = approvalRows(q.data?.approvals, Date.now());
  if (!rows.length) return null;
  return (
    <Panel>
      <BlockHead
        title={t("contracts.overview.approvals.title")}
        meta={t("contracts.overview.work.count", { n: rows.length })}
      />
      <ul data-testid="approval-tasks">
        {rows.map((r) => (
          <li
            key={r.taskId}
            data-testid="approval-task-row"
            className="border-b border-rule-soft last:border-b-0"
          >
            <Link
              to="/contracts/$id"
              params={{ id: r.contractId }}
              className="flex min-w-0 items-center gap-3 px-5 py-3 max-sm:px-4"
            >
              <Tag tone={r.due?.late ? "late" : "act"}>{r.stage}</Tag>
              <b className="min-w-0 flex-1 truncate text-[14.5px] font-semibold">
                {r.title || t("contracts.overview.approvals.untitled")}
              </b>
              {r.escalated && (
                <span className="shrink-0 text-[12.5px] text-soon">
                  {t("contracts.approval.engine.escalatedShort")}
                </span>
              )}
              {r.due && (
                <span
                  className={`tnum shrink-0 text-[12.5px] ${r.due.late ? "font-semibold text-late" : "text-dim"}`}
                >
                  {r.due.late
                    ? t("contracts.overview.approvals.late", {
                        date: new Date(r.due.at).toLocaleDateString(),
                      })
                    : t("contracts.overview.approvals.due", {
                        date: new Date(r.due.at).toLocaleDateString(),
                      })}
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
