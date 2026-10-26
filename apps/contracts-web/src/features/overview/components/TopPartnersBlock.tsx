// V2-N · "Giao dịch nhiều nhất" (mockup `partnerPanel.top`): top 3 nhà cung cấp + top 3 khách hàng theo số việc đã ghi (engine HD8 `GET /partners`),
// kèm điểm uy tín. (Mockup xếp theo giá trị HĐ; API chưa trả giá trị nên dùng số việc.)
import type { PartnerRole, PartnerRow } from "@ai/contracts";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Panel } from "~/components/shared/layout";
import { ErrorLine, Loading } from "~/components/shared/states";
import { RepBadge } from "~/features/partners/components/RepBadge";
import { usePartnerRows } from "~/features/partners/hooks/use-partner-scores";
import { topPartners } from "~/features/partners/lib/partner-score";
import { BlockHead } from "./BlockHead";

function Col({ kind, rows }: { kind: PartnerRole; rows: PartnerRow[] }) {
  const { t } = useTranslation();
  return (
    <div data-role={kind}>
      <h3 className="mb-1 text-label font-semibold text-dim">
        {t(`contracts.pv2.roleWord.${kind}`)}
      </h3>
      {rows.length === 0 ? (
        <p className="py-1.5 text-label text-dim">{t("contracts.overview.top.none")}</p>
      ) : (
        rows.map((p) => (
          <Link
            key={p.party}
            to="/partners"
            search={{ party: p.party, role: p.role }}
            className="flex items-center gap-2 rounded-md px-1.5 py-1.5 hover:bg-sunk"
          >
            <span className="min-w-0 flex-1">
              <b className="block truncate text-body">{p.name}</b>
              <span className="block text-[12px] text-dim">
                {t("contracts.overview.top.jobs", { n: p.event_count })}
              </span>
            </span>
            <RepBadge row={p} />
          </Link>
        ))
      )}
    </div>
  );
}

export function TopPartnersBlock() {
  const { t } = useTranslation();
  const q = usePartnerRows();
  return (
    <Panel>
      <BlockHead
        title={t("contracts.overview.top.title")}
        meta={t("contracts.overview.top.lead")}
      />
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorLine error={q.error} />
      ) : (
        <div className="grid grid-cols-2 gap-4 p-4 max-sm:grid-cols-1" data-testid="top-partners">
          <Col kind="supplier" rows={topPartners(q.data, "supplier")} />
          <Col kind="customer" rows={topPartners(q.data, "customer")} />
        </div>
      )}
    </Panel>
  );
}
