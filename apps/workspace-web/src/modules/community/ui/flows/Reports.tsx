// CR-120 · CR-137 · Báo cáo vi phạm (người duyệt): BẢNG toàn chiều ngang (bài · loại · ngày · trạng thái · lý do), bấm dòng ⇒ hộp thoại chi tiết; quyết Ẩn bài / Cảnh báo / Bỏ qua.
// Gợi ý phân loại tự động chỉ để tham khảo.
import type { Report } from "@ai/contracts/community";
import { Btn } from "~/components/ui/Btn";
import { useApp } from "../../application/ctx";
import { shortDay } from "../../domain/admin-list";
import { isConflict, reportKindKey, reportLevelKey } from "../../domain/flows";
import { numLocale, t } from "../../i18n";
import { AdminList, type Column } from "./AdminList";
import { FlowPage, ListState, useFlowList } from "./parts";

const ACTIONS = ["hide", "warn", "dismiss"] as const;
const STATUSES = ["pending", "resolved"] as const;
const statusTag = (r: Report) => (
  <span className={r.status === "pending" ? "tag soon sm" : "tag ok sm"}>
    {t(`community.flows.reports.status.${r.status}`)}
  </span>
);
const title = (r: Report) => r.postTitle || t("community.flows.reports.postUntitled");

const columns = (): Column<Report>[] => [
  { key: "post", head: t("community.flows.reports.colPost"), cell: title },
  { key: "kind", head: t("community.flows.reports.colKind"), cell: (r) => t(reportKindKey(r)) },
  {
    key: "date",
    head: t("community.flows.common.colDate"),
    cell: (r) => shortDay(r.createdAt, numLocale()),
  },
  { key: "status", head: t("community.flows.common.colStatus"), cell: statusTag },
  { key: "sum", head: t("community.flows.common.colSummary"), cell: (r) => r.reason },
];

function ReportDetail({
  r,
  onDecide,
}: {
  r: Report;
  onDecide: (a: (typeof ACTIONS)[number]) => void;
}) {
  const level = reportLevelKey(r);
  return (
    <div data-testid="report-detail" data-post-id={r.postId}>
      <div className="pbody">
        <p>
          <b data-testid="report-post-title">{title(r)}</b>
        </p>
        <p>
          <span className="tag grey sm">{t(reportKindKey(r))}</span>{" "}
          {level && <span className="tag soon sm">{t(level)}</span>} {statusTag(r)}
        </p>
        <p className="muted">{shortDay(r.createdAt, numLocale())}</p>
        <p>
          <b>{t("community.flows.reports.reason")}:</b> {r.reason}
        </p>
        {r.status === "resolved" && r.action && (
          <p className="muted">
            {t(`community.flows.reports.result.${r.action}`, { by: r.decidedBy ?? "" })}
          </p>
        )}
      </div>
      {r.status === "pending" && (
        <div className="cbar">
          <div className="sp" />
          {ACTIONS.map((a) => (
            <Btn
              key={a}
              variant={a === "hide" ? "primary" : "outline"}
              size="sm"
              data-testid={`report-${a}`}
              onClick={() => onDecide(a)}
            >
              {t(`community.flows.reports.action.${a}`)}
            </Btn>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ReportsPage() {
  const { api, toast, bump } = useApp();
  const list = useFlowList(() => api.flows.listReports(false));
  const decide = async (r: Report, action: (typeof ACTIONS)[number]) => {
    try {
      await api.flows.decideReport(r.id, { action, taskId: r.taskId });
      toast(t(`community.flows.reports.done.${action}`));
      bump();
    } catch (e) {
      if (!isConflict(e)) throw e;
      toast(t("community.flows.reports.conflict"));
      list.reload();
    }
  };
  return (
    <FlowPage
      title={t("community.flows.reports.title")}
      intro={t("community.flows.reports.intro")}
      testId="reports-page"
      bare
    >
      {(list.failed || !list.items) && (
        <ListState {...list} emptyKey="community.flows.reports.empty" />
      )}
      {list.items && !list.failed && (
        <AdminList
          testId="reports-list"
          rowTestId="report-item"
          rows={list.items}
          statuses={STATUSES}
          pendingStatus="pending"
          statusLabel={(s) => t(`community.flows.reports.status.${s}`)}
          columns={columns()}
          detailTitle={t("community.flows.reports.detailTitle")}
          emptyKey="community.flows.reports.empty"
          detail={(r) => <ReportDetail r={r} onDecide={(a) => void decide(r, a)} />}
        />
      )}
    </FlowPage>
  );
}
