// CR-126 · «Việc của tôi» (/contracts/approvals): MỘT hộp việc — duyệt HĐ + ký (`GET /my-work`) và bước yêu cầu/quy trình/phiếu
// (`GET /me/review-tasks`, gồm run con). Mỗi dòng: việc nào · bước nào · mở. Rỗng ⇒ nói vì sao + bước kế.
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { PageHead, Panel } from "~/components/shared/layout";
import { Skeleton } from "~/components/ui/skeleton";
import { ApprovalRowList } from "../components/ApprovalTasksBlock";
import { BlockHead } from "../components/BlockHead";
import { SigningRowList } from "../components/SigningRowList";
import { useInbox } from "../hooks/use-inbox";
import { approvalRows } from "../lib/approvals";

export function ApprovalsInboxPage() {
  const { t } = useTranslation();
  const { work, requests, runByTask, count } = useInbox();
  const rows = approvalRows(work.data?.approvals, Date.now());
  const signing = work.data?.signing ?? [];
  const loading = work.isPending || requests.kind === "loading";
  return (
    <div data-testid="approvals-inbox">
      <PageHead
        title={t("contracts.approvalsPage.title")}
        lead={t("contracts.approvalsPage.subtitle")}
      />
      {loading ? (
        <Skeleton className="h-24 w-full" />
      ) : work.isError || requests.kind === "error" ? (
        <p role="alert" className="text-sm text-late" data-testid="requests-waiting-error">
          {t("contracts.approvalsPage.loadError")}
        </p>
      ) : count === 0 ? (
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
              <ApprovalRowList rows={rows} runByTask={runByTask} />
            </Panel>
          )}
          {requests.kind === "list" && (
            <Panel>
              <ul data-testid="requests-waiting" className="m-0 list-none p-0">
                {requests.items.map((i) => (
                  <li key={i.task.id} className="border-b border-rule-soft last:border-b-0">
                    <Link
                      to="/contracts/requests/$runId"
                      params={{ runId: i.process_run.id }}
                      data-testid="requests-waiting-row"
                      className="flex min-w-0 items-center gap-3 px-5 py-3 max-sm:px-4"
                    >
                      <b className="min-w-0 flex-1 truncate text-[14.5px] font-semibold">
                        {i.process_run.process.name}
                      </b>
                      <span className="shrink-0 text-label text-dim">{i.task.stage_name}</span>
                      <span className="text-sm font-medium text-act">
                        {t("contracts.approvalsPage.open")}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      )}
    </div>
  );
}
