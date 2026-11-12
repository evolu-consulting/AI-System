// CR-126 · «Việc của tôi» (/contracts/approvals): MỘT hộp việc — duyệt HĐ + ký (`GET /my-work`) và bước yêu cầu/quy trình/phiếu
// (`GET /me/review-tasks`, gồm run con). Mỗi dòng: việc nào · bước nào · mở. Rỗng ⇒ nói vì sao + bước kế.
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { PageHead, Panel } from "~/components/shared/layout";
import { Skeleton } from "~/components/ui/skeleton";
import { InboxChips, InboxRowList } from "../components/InboxRowList";
import { useInbox } from "../hooks/use-inbox";
import { filterInbox, type InboxFilter, inboxRows } from "../lib/inbox";

export function ApprovalsInboxPage() {
  const { t } = useTranslation();
  const { work, requests, itemByTask, count } = useInbox();
  const [filter, setFilter] = useState<InboxFilter>("all");
  const all = inboxRows({
    approvals: work.data?.approvals ?? [],
    signing: work.data?.signing ?? [],
    inbox: work.data?.inbox ?? [],
    requests: requests.kind === "list" ? requests.items : [],
    itemByTask,
    signTag: t("contracts.waiting.signTag"),
    now: Date.now(),
  });
  const shown = filterInbox(all, filter);
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
        <Panel>
          <InboxChips value={filter} onChange={setFilter} />
          <InboxRowList rows={shown} />
        </Panel>
      )}
    </div>
  );
}
