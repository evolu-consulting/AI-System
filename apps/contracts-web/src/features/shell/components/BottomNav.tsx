// PK-FR-10 · TF5 · nav-v2 · điện thoại: cùng 4 mục của menu trái ở thanh dưới, tầm ngón cái.
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { NAV } from "../lib/nav";

export function BottomNav() {
  const { t } = useTranslation();
  return (
    <nav
      aria-label={t("contracts.shell.navBottom")}
      className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-4 border-t border-rule bg-panel md:hidden"
    >
      {NAV.map((n) => (
        <Link
          key={n.to}
          to={n.to}
          className="flex h-14 flex-col items-center justify-center gap-0.5 px-1 text-micro text-dim aria-[current=page]:font-semibold aria-[current=page]:text-act"
        >
          <n.icon width={19} height={19} />
          <span className="max-w-full truncate">{t(n.labelKey)}</span>
        </Link>
      ))}
    </nav>
  );
}
