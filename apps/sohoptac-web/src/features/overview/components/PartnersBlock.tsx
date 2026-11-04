// nav-v2 · U3 · khối "Đối tác cần xem lại" của Tổng quan: đối tác có cờ đỏ (R39) hoặc mức CHÚ Ý (engine HD8, `GET /partners`). Cờ đỏ lên đầu.
// "giảm từ 3 điểm trong 3 tháng" của mockup cần lịch sử điểm chưa có ở API, nên chưa làm.
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Panel } from "~/components/shared/layout";
import { ErrorLine, Loading } from "~/components/shared/states";
import { RedFlagTag } from "~/features/partners/components/RedFlagTag";
import { RepBadge } from "~/features/partners/components/RepBadge";
import { usePartnerRows } from "~/features/partners/hooks/use-partner-scores";
import { useEngine } from "~/features/partners/hooks/use-rep-v2e";
import { flagsOf, partnersToReview } from "~/features/partners/lib/partner-score";
import { AttentionBlock } from "./AttentionBlock";
import { BlockHead } from "./BlockHead";

function Hd8Block() {
  const { t } = useTranslation();
  const q = usePartnerRows();
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
                <span className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-dim">
                  {t(`contracts.pv2.roleWord.${p.role}`)}
                  {p.red_flag && <RedFlagTag flags={flagsOf([p])} />}
                </span>
              </span>
              <RepBadge row={p} />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/** REP-v3-ui: HD8 = "Đối tác cần xem lại" (cờ đỏ hoặc CHÚ Ý); V2-E = "Cần chú ý" TQ-04 (`GET /reputation/attention`, có "giảm ≥ 3 điểm / 3 tháng"). */
export function PartnersBlock() {
  const { engine } = useEngine();
  return engine === "v2e" ? <AttentionBlock /> : <Hd8Block />;
}
