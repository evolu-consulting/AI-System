// CR-125 · UX L2 · công ty chưa có dữ liệu (doanh thu/lãi/hoa hồng đều 0, chưa có nhóm sản phẩm) ⇒ thẻ "Bắt đầu nhanh" thay vì chỉ
// một hàng số 0đ: nói việc đầu tiên cần làm. Thuần phần quyết định (`isEmptyOverview`) để test.
import type { OverviewOut } from "@ai/contracts/pack-contracts";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

export const isEmptyOverview = (
  d: Pick<OverviewOut, "revenue" | "commission" | "gross_profit" | "groups"> | undefined,
): boolean =>
  !!d &&
  d.revenue.expected === 0 &&
  d.revenue.actual === 0 &&
  d.commission.expected === 0 &&
  d.commission.actual === 0 &&
  d.gross_profit.amount === 0 &&
  d.groups.length === 0;

export function QuickStartCard({ write }: { write: boolean }) {
  const { t } = useTranslation();
  return (
    <section
      data-testid="quick-start"
      className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-line bg-panel px-5 py-3.5 max-sm:px-4"
    >
      <span className="min-w-0 flex-1">
        <b className="block text-[15px] font-semibold">
          {t("contracts.overview.quickStart.title")}
        </b>
        <span className="block text-[12.5px] text-dim">
          {t(
            write ? "contracts.overview.quickStart.body" : "contracts.overview.quickStart.bodyRole",
          )}
        </span>
      </span>
      {write && (
        <Link to="/contracts/list" className="btn btn-primary btn-sm">
          {t("contracts.overview.quickStart.cta")}
        </Link>
      )}
    </section>
  );
}
