// CR-120 · Báo cáo vi phạm (người duyệt): danh sách MỘT yêu cầu; quyết Ẩn bài / Cảnh báo / Bỏ qua. Gợi ý phân loại tự động chỉ để tham khảo.
import type { Report } from "@ai/contracts/community";
import { useApp } from "../../application/ctx";
import { isConflict, reportKindKey, reportLevelKey } from "../../domain/flows";
import { t } from "../../i18n";
import { FlowPage, ListState, useFlowList } from "./parts";

const ACTIONS = ["hide", "warn", "dismiss"] as const;

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
    >
      <ListState {...list} emptyKey="community.flows.reports.empty" />
      {list.items?.map((r) => {
        const level = reportLevelKey(r);
        return (
          <article
            className="card post"
            key={r.id}
            data-testid="report-item"
            data-post-id={r.postId}
          >
            <div className="ph">
              <div className="who">
                <b data-testid="report-post-title">
                  {r.postTitle || t("community.flows.reports.postUntitled")}
                </b>
                <div className="meta">
                  <span className="tag grey sm">{t(reportKindKey(r))}</span>
                  {level && <span className="tag soon sm">{t(level)}</span>}
                  <span className={r.status === "pending" ? "tag soon sm" : "tag ok sm"}>
                    {t(`community.flows.reports.status.${r.status}`)}
                  </span>
                </div>
              </div>
            </div>
            <div className="pbody">
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
                  <button
                    key={a}
                    type="button"
                    className={a === "hide" ? "primary sm" : "ghost"}
                    data-testid={`report-${a}`}
                    onClick={() => void decide(r, a)}
                  >
                    {t(`community.flows.reports.action.${a}`)}
                  </button>
                ))}
              </div>
            )}
          </article>
        );
      })}
    </FlowPage>
  );
}
