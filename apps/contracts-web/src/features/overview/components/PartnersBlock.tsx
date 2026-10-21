// nav-v2 · khối "Đối tác cần xem lại" của Tổng quan: đối tác ở mức CHÚ Ý (điểm uy tín, API `GET /partners`). Bản đầu chỉ có mức CHÚ Ý —
// "giảm từ 3 điểm trong 3 tháng" của mockup cần lịch sử điểm chưa có ở API, nên chưa làm.
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Panel } from "~/components/shared/layout";
import { ErrorLine, Loading } from "~/components/shared/states";
import { RepBadge } from "~/features/partners/components/RepBadge";
import { useRepPartners } from "~/features/partners/hooks/use-partner-rep";
import { partnersToReview } from "../lib/overview";
import { BlockHead } from "./BlockHead";

export function PartnersBlock() {
  const { t } = useTranslation();
  const q = useRepPartners();
  const rows = partnersToReview(q.data);
  return (
    <Panel>
      <BlockHead
        title={t("contracts.overview.partners.title")}
        meta={t("contracts.overview.partners.lead")}
        aside={
          <Link to="/partners" className="font-medium text-act hover:underline">
            {t("contracts.overview.partners.all")}
          </Link>
        }
      />
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorLine error={q.error} />
      ) : rows.length === 0 ? (
        <p className="px-5 py-4 text-label text-dim">{t("contracts.overview.partners.none")}</p>
      ) : (
        <ul data-testid="review-partners">
          {rows.map((p) => (
            <li
              key={`${p.party}:${p.role}`}
              className="flex items-center gap-3 border-t border-rule-soft px-5 py-3 first:border-t-0"
            >
              <span className="min-w-0 flex-1">
                <Link
                  to="/partners"
                  search={{ party: p.party, role: p.role }}
                  className="block truncate text-body font-semibold hover:text-act hover:underline"
                >
                  {p.name}
                </Link>
                <span className="block truncate text-[12.5px] text-dim">
                  {t(`contracts.pv2.roleWord.${p.role}`)}
                </span>
              </span>
              <RepBadge score={p.score} level={p.level} />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
