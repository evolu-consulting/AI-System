// PK-FR-10 · TF5 · điện thoại: 4 mục ở thanh dưới, tầm ngón cái. Nguồn: mgmt-app Shell.tsx.
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { MAIN_NAV } from "../lib/nav";

export function BottomNav() {
  const { t } = useTranslation();
  return (
    <nav
      aria-label={t("contracts.shell.navBottom")}
      className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-4 border-t border-rule bg-panel md:hidden"
    >
      {MAIN_NAV.map((n) => (
        <Link
          key={n.to}
          to={n.to}
          className="flex h-14 flex-col items-center justify-center gap-0.5 text-micro text-dim aria-[current=page]:font-semibold aria-[current=page]:text-act"
        >
          <n.icon width={19} height={19} />
          {t(n.labelKey)}
        </Link>
      ))}
    </nav>
  );
}
