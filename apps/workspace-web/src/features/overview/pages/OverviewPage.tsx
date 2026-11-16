// nav-v2 · /overview "Tổng quan" (mockup NITI): đầu trang chọn kỳ (Tháng này / Quý này / 12 tháng) + 4 con số (V2-K `GET /overview`); hai cột:
// trái Hạn và nhắc việc (V2-K `GET /my-work/todo`) · Theo nhóm SP · Đối tác cần xem lại; phải Hợp đồng · SP nên làm gì (V2-J1) · Giao dịch nhiều nhất (V2-E).
import type { OverviewPeriod } from "@ai/contracts/pack-contracts";
import { PageHeader } from "@ai/web-kit/ui/kit/page-header";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { viDate } from "~/components/shared/format";
import { useMe } from "~/features/pack-state/hooks/use-me";
import { cn } from "~/lib/utils";
import { fetchOverview, overviewKeys } from "../api";
import { ApprovalTasksBlock } from "../components/ApprovalTasksBlock";
import { ContractsBlock } from "../components/ContractsBlock";
import { GroupsBlock } from "../components/GroupsBlock";
import { KpiBlock } from "../components/KpiBlock";
import { PartnersBlock } from "../components/PartnersBlock";
import { isEmptyOverview, QuickStartCard } from "../components/QuickStartCard";
import { RecsBlock } from "../components/RecsBlock";
import { TodoBlock } from "../components/TodoBlock";
import { TopPartnersBlock } from "../components/TopPartnersBlock";
import { WaitingForMeCard } from "../components/WaitingForMeCard";
import { PERIODS } from "../lib/overview";

export function OverviewPage() {
  const { t } = useTranslation();
  const [period, setPeriod] = useState<OverviewPeriod>("month");
  const { write } = useMe();
  // `today` là ngày theo múi tenant do máy chủ trả (không đọc đồng hồ máy).
  const q = useQuery({
    queryKey: overviewKeys.figures(period),
    queryFn: ({ signal }) => fetchOverview(period, signal),
    placeholderData: (p) => p,
  });
  const today = q.data?.today;
  return (
    <div className="text-base leading-[1.55]">
      <PageHeader
        className="mb-5"
        title={t("contracts.overview.title")}
        description={today && t("contracts.overview.today", { date: viDate(today) })}
        primary={
          <Link
            to="/contracts/requests"
            className="btn btn-primary btn-sm max-sm:justify-center"
            data-testid="quick-new-request"
          >
            {t("contracts.requests.quick")}
          </Link>
        }
      >
        <fieldset className="m-0 inline-flex min-w-0 rounded-lg border border-rule bg-sunk p-0.5 max-sm:flex max-sm:w-full max-sm:[&>button]:flex-1">
          <legend className="sr-only">{t("contracts.overview.period.label")}</legend>
          {PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={period === p}
              data-period={p}
              onClick={() => setPeriod(p)}
              className={cn(
                "h-8 rounded-md px-3 text-label font-medium max-sm:h-11",
                period === p ? "bg-panel text-ink shadow-sm" : "text-dim hover:text-ink",
              )}
            >
              {t(`contracts.overview.period.${p}`)}
            </button>
          ))}
        </fieldset>
      </PageHeader>
      <WaitingForMeCard />
      {isEmptyOverview(q.data) && <QuickStartCard write={write} />}
      <div className="mb-4">
        <KpiBlock data={q.data} loading={q.isLoading} error={q.error} period={period} />
      </div>
      <div className="grid grid-cols-[minmax(0,7fr)_minmax(0,5fr)] items-start gap-4 max-[1100px]:grid-cols-1">
        <div className="flex min-w-0 flex-col gap-4">
          <ApprovalTasksBlock />
          <TodoBlock />
          {q.data && <GroupsBlock data={q.data} />}
          <PartnersBlock />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <ContractsBlock today={today} />
          <RecsBlock />
          <TopPartnersBlock />
        </div>
      </div>
    </div>
  );
}
