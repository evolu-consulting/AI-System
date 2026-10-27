// REP-v3-ui · TQ-04 (R71) · khối "Cần chú ý" của Tổng quan khi `engine = v2e` (`GET /reputation/attention`): đối tác CHÚ Ý, có cờ đỏ, hoặc điểm vai
// giảm ≥ 3 so với kỳ chốt 3 tháng trước. Cờ đỏ lên đầu (máy chủ đã xếp). Cờ đỏ tách khỏi điểm; số điểm đã giảm hiện cạnh vai.
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Panel } from "~/components/shared/layout";
import { ErrorLine, Loading } from "~/components/shared/states";
import { RedFlagTag } from "~/features/partners/components/RedFlagTag";
import { RepBadge } from "~/features/partners/components/RepBadge";
import { useRepAttention } from "~/features/partners/hooks/use-rep-v2e";
import { fromAttention } from "~/features/partners/lib/partner-score";
import { BlockHead } from "./BlockHead";

export function AttentionBlock() {
  const { t } = useTranslation();
  const q = useRepAttention(true);
  const rows = (q.data ?? []).map(fromAttention);
  return (
    <Panel>
      <BlockHead
        title={t("contracts.rep3.attention.title")}
        meta={t("contracts.rep3.attention.lead")}
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
        <p className="px-5 py-4 text-label text-dim">{t("contracts.rep3.attention.none")}</p>
      ) : (
        <ul data-testid="attention-partners">
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
                  {p.red_flag && <RedFlagTag flags={p.red_flags ?? []} />}
                  {p.reasons.includes("watch") && (
                    <span data-testid="reason-watch">{t("contracts.rep3.attention.watch")}</span>
                  )}
                  {p.drop !== null && p.reasons.includes("drop") && (
                    <span data-testid="reason-drop" className="font-medium text-soon">
                      {t("contracts.rep3.attention.drop", { n: p.drop, before: p.before })}
                    </span>
                  )}
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
