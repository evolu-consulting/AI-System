// CR-189 BR-189-1 · «Thành viên & phòng ban»: hai tab — «Sơ đồ tổ chức» (đứng đầu, mở mặc định) và «Thành viên».
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

const tab =
  "-mb-px border-b-2 px-3 py-2.5 text-body max-sm:min-h-11 border-transparent text-dim aria-[current=page]:border-act aria-[current=page]:font-semibold aria-[current=page]:text-ink";

export function OrgTabs({ active }: { active: "chart" | "members" }) {
  const { t } = useTranslation();
  return (
    <nav
      aria-label={t("contracts.org.title")}
      data-testid="org-tabs"
      className="mb-4 flex gap-1 border-b border-rule"
    >
      <Link
        to="/contracts/org"
        className={tab}
        aria-current={active === "chart" ? "page" : undefined}
        data-testid="org-tab-chart"
      >
        {t("contracts.org.tabChart")}
      </Link>
      <Link
        to="/contracts/settings/members"
        className={tab}
        aria-current={active === "members" ? "page" : undefined}
        data-testid="org-tab-members"
      >
        {t("contracts.org.tabMembers")}
      </Link>
    </nav>
  );
}
