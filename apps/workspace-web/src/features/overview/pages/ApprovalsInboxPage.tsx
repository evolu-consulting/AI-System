// CR-121 C-7 · trang "Chờ tôi duyệt" (mục menu cap `contracts.review`): HĐ có bước duyệt đang chờ người xem — dữ liệu sẵn có
// (`GET /my-work` → approvals[], cùng luật canAct của engine). Rỗng ⇒ nói vì sao + bước kế (không để trang trống).
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { PageHead, Panel } from "~/components/shared/layout";
import { Skeleton } from "~/components/ui/skeleton";
import { ApprovalRowList } from "../components/ApprovalTasksBlock";
import { useMyApprovals } from "../hooks/use-overview";
import { approvalRows } from "../lib/approvals";

export function ApprovalsInboxPage() {
  const { t } = useTranslation();
  const q = useMyApprovals();
  const rows = approvalRows(q.data?.approvals, Date.now());
  return (
    <div data-testid="approvals-inbox">
      <PageHead
        title={t("contracts.approvalsPage.title")}
        lead={t("contracts.approvalsPage.subtitle")}
      />
      {q.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : q.isError ? (
        <p role="alert" className="text-sm text-late">
          {t("contracts.approvalsPage.loadError")}
        </p>
      ) : rows.length === 0 ? (
        <Panel className="px-6 py-10 text-center">
          <div data-testid="approvals-empty">
            <p className="text-body font-semibold">{t("contracts.approvalsPage.emptyTitle")}</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-dim">
              {t("contracts.approvalsPage.emptyBody")}
            </p>
            <Link
              to="/contracts/list"
              className="mt-4 inline-block text-sm font-medium text-act hover:underline"
            >
              {t("contracts.approvalsPage.emptyNext")}
            </Link>
          </div>
        </Panel>
      ) : (
        <Panel>
          <ApprovalRowList rows={rows} />
        </Panel>
      )}
    </div>
  );
}
