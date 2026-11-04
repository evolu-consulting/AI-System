// V2-I · DT-01…07 · `/partners?party=` — trang chi tiết đối tác theo mockup NITI: đầu trang (tên, điểm từng vai, MST · điện thoại · liên hệ,
// "Tìm trên internet") + 3 tab: Tổng quan · Hợp đồng · n · Đánh giá & ghi chú. Tab / vai / khoảng biểu đồ nằm trên URL.
import type { PartnerRole, RepRole } from "@ai/contracts";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ErrorLine, Loading } from "~/components/shared/states";
import { useMe } from "~/features/pack-state/hooks/use-me";
import { fetchContractCounts, fetchProfile, fetchRoles, partnerKeys } from "../api";
import { ContractsTab } from "../components/ContractsTab";
import { OverviewTab } from "../components/OverviewTab";
import { OverviewTabV2E } from "../components/OverviewTabV2E";
import { PartnerHeader } from "../components/PartnerHeader";
import { PartnerTabs } from "../components/PartnerTabs";
import { ReviewTab } from "../components/ReviewTab";
import { ReviewTabV2E } from "../components/ReviewTabV2E";
import { usePartnerRows } from "../hooks/use-partner-scores";
import { type PartnersSearch, type Range, rolesOf, type Tab } from "../lib/partner-v2";

type PanelProps = {
  party: string;
  tab: Tab;
  role: RepRole | null;
  roles: RepRole[];
  range: Range;
  v2e: boolean;
};

/** Thân tab theo engine: HD8 (bảng tiêu chí, sổ việc) hoặc V2-E (vai × nhóm SP, biểu đồ, sao). */
function PartnerPanel({ party, tab, role, roles, range, v2e }: PanelProps) {
  const { t } = useTranslation();
  if (tab === "contracts") return <ContractsTab party={party} />;
  if (tab === "review")
    return v2e ? (
      <ReviewTabV2E party={party} role={role} roles={roles} range={range} />
    ) : (
      <ReviewTab party={party} roles={roles} />
    );
  if (!role) return <p className="text-label text-dim">{t("contracts.pv2.noRole")}</p>;
  return v2e ? (
    <OverviewTabV2E party={party} role={role} roles={roles} range={range} />
  ) : (
    <OverviewTab party={party} role={role as PartnerRole} roles={roles as PartnerRole[]} />
  );
}
export function PartnerDetailPage({ search }: { search: PartnersSearch & { party: string } }) {
  const { write } = useMe();
  const { party } = search;
  const tab = search.tab ?? "overview";
  const list = usePartnerRows();
  const profile = useQuery({
    queryKey: partnerKeys.profile(party),
    queryFn: ({ signal }) => fetchProfile(party, signal),
  });
  const rolesQ = useQuery({
    queryKey: partnerKeys.roles(party),
    queryFn: ({ signal }) => fetchRoles(party, signal),
  });
  const counts = useQuery({
    queryKey: partnerKeys.counts,
    queryFn: ({ signal }) => fetchContractCounts(signal),
  });
  if (profile.isLoading || list.isLoading) return <Loading />;
  if (profile.error) return <ErrorLine error={profile.error} />;
  const rows = (list.data ?? []).filter((r) => r.party === party);
  const v2e = list.engine === "v2e";
  const roles = rolesOf(
    v2e,
    rows.map((x) => x.role),
    (rolesQ.data ?? []).map((x) => x.role),
  );
  const role = roles.find((r) => r === search.role) ?? roles[0] ?? null;
  const name = profile.data?.name ?? rows[0]?.name ?? party;
  return (
    <div className="text-base leading-[1.55]">
      <PartnerHeader
        party={party}
        name={name}
        roles={roles}
        rows={rows}
        profile={profile.data}
        write={write}
      />
      <PartnerTabs
        party={party}
        role={search.role}
        tab={tab}
        contracts={counts.data?.find((c) => c.party === party)?.n ?? 0}
      />
      <div
        role="tabpanel"
        id="partner-panel"
        aria-labelledby={`partner-tab-${tab}`}
        className="space-y-4"
      >
        <PartnerPanel
          party={party}
          tab={tab}
          role={role}
          roles={roles}
          range={search.range ?? 12}
          v2e={v2e}
        />
      </div>
    </div>
  );
}
