// nav-v2 · /overview "Tổng quan" (trang đầu, mockup NITI): hai cột 7fr/5fr — trái "Cần xử lý" (việc của tôi), phải "Hợp đồng" và
// "Đối tác cần xem lại". Bản đầu chỉ dùng dữ liệu/API sẵn có; khối cần số liệu mới (kết quả kinh doanh, gợi ý sản phẩm) CHƯA hiện (ẩn, không placeholder).
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { viDate } from "~/components/shared/format";
import { PageHead } from "~/components/shared/layout";
import { fetchMyWork, workKeys } from "~/features/mywork/api";
import { ContractsBlock } from "../components/ContractsBlock";
import { PartnersBlock } from "../components/PartnersBlock";
import { WorkBlock } from "../components/WorkBlock";

export function OverviewPage() {
  const { t } = useTranslation();
  // Cùng khoá với khối "Cần xử lý": một lần gọi; `today` là ngày theo múi tenant do máy chủ trả (không đọc đồng hồ máy).
  const work = useQuery({ queryKey: workKeys.all, queryFn: ({ signal }) => fetchMyWork(signal) });
  const today = work.data?.today;
  return (
    <div className="text-base leading-[1.55]">
      <PageHead
        title={t("contracts.overview.title")}
        lead={today && t("contracts.overview.today", { date: viDate(today) })}
      />
      <div className="grid grid-cols-[minmax(0,7fr)_minmax(0,5fr)] items-start gap-4 max-[1100px]:grid-cols-1">
        <WorkBlock today={today} />
        <div className="flex min-w-0 flex-col gap-4">
          <ContractsBlock today={today} />
          <PartnersBlock />
        </div>
      </div>
    </div>
  );
}
