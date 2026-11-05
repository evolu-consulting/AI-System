// V2-I · thanh tab của trang chi tiết đối tác (liên kết `?tab=`, giữ vai): Tổng quan · Hợp đồng · n · Đánh giá & ghi chú.

import type { RepRole } from "@ai/contracts";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { TABS, type Tab } from "../lib/partner-v2";

export function PartnerTabs({
  party,
  role,
  tab,
  contracts,
}: {
  party: string;
  role: RepRole | undefined;
  tab: Tab;
  contracts: number;
}) {
  const { t } = useTranslation();
  return (
    <div
      role="tablist"
      aria-label={t("contracts.pv2.tabs")}
      className="mb-4 flex gap-1 overflow-x-auto border-b border-rule"
    >
      {TABS.map((k) => (
        <Link
          key={k}
          to="/partners"
          search={{ party, ...(role ? { role } : {}), ...(k === "overview" ? {} : { tab: k }) }}
          role="tab"
          id={`partner-tab-${k}`}
          aria-selected={tab === k}
          aria-controls="partner-panel"
          className="-mb-px border-b-2 border-transparent px-3.5 py-2.5 text-body whitespace-nowrap text-ink-2 hover:text-ink aria-selected:border-act aria-selected:font-semibold aria-selected:text-act"
        >
          {k === "contracts"
            ? t("contracts.pv2.tab.contracts", { n: contracts })
            : t(`contracts.pv2.tab.${k}`)}
        </Link>
      ))}
    </div>
  );
}
