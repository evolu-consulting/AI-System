// CR-121 C-7 · trang "Chờ tôi duyệt" (mục menu cap `contracts.review`): HĐ có bước duyệt đang chờ người xem — dữ liệu sẵn có
// (`GET /my-work` → approvals[], cùng luật canAct của engine). Rỗng ⇒ nói vì sao + bước kế (không để trang trống).
// CR-125 · x1: cùng đọc đó có `signing[]` — HĐ chờ chính người xem KÝ; hiện ngay dưới danh sách duyệt (thẻ "Chờ bạn" ở Tổng quan trỏ về đây).
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { PageHead, Panel } from "~/components/shared/layout";
import { Skeleton } from "~/components/ui/skeleton";
import { ApprovalRowList } from "../components/ApprovalTasksBlock";
import { BlockHead } from "../components/BlockHead";
import { SigningRowList } from "../components/SigningRowList";
import { useMyApprovals } from "../hooks/use-overview";
import { approvalRows } from "../lib/approvals";
import { waitingOf } from "../lib/waiting";

export function ApprovalsInboxPage() {
  const { t } = useTranslation();
  const q = useMyApprovals();
  const rows = approvalRows(q.data?.approvals, Date.now());
  const signing = q.data?.signing ?? [];
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
      ) : waitingOf(q.data).total === 0 ? (
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
        <div className="flex flex-col gap-4">
          {signing.length > 0 && (
            <Panel>
              <BlockHead title={t("contracts.waiting.signSection")} meta={String(signing.length)} />
              <SigningRowList rows={signing} />
            </Panel>
          )}
          {rows.length > 0 && (
            <Panel>
              <ApprovalRowList rows={rows} />
            </Panel>
          )}
        </div>
      )}
    </div>
  );
}
