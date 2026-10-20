// nav-v2 · khối "Đối tác cần xem lại" của Tổng quan: đối tác ở mức CHÚ Ý (điểm uy tín, API `GET /partners`). Bản đầu chỉ có mức CHÚ Ý —
// "giảm từ 3 điểm trong 3 tháng" của mockup cần lịch sử điểm chưa có ở API, nên chưa làm.
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Panel } from "~/components/shared/layout";
import { ErrorLine, Loading } from "~/components/shared/states";
import { fetchPartners, partnerKeys } from "~/features/partners/api";
import { ScoreBadge } from "~/features/partners/components/ScoreBadge";
import { partnersToReview } from "../lib/overview";
import { BlockHead } from "./BlockHead";

export function PartnersBlock() {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: partnerKeys.list("all"),
    queryFn: ({ signal }) => fetchPartners("all", signal),
  });
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
                <span className="block truncate text-body font-semibold">{p.name}</span>
                <span className="block truncate text-[12.5px] text-dim">
                  {t(`contracts.partners.roleWord.${p.role}`)}
                  {p.reason ? ` · ${p.reason}` : ""}
                </span>
              </span>
              <ScoreBadge score={p.score} band={p.band} />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
