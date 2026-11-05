// PK-FR-10 · TF5 · nav-v2 · CR-120 · điện thoại: cùng các mục của menu trái (sinh từ manifest) ở thanh dưới, tầm ngón cái; tối đa 5 cột.
import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { MODULES } from "~/shell/modules";
import { buildShellNav } from "~/shell/nav";
import { useShellPacks } from "~/shell/use-shell-packs";

export function BottomNav() {
  const { t } = useTranslation();
  const packs = useShellPacks();
  const items = useMemo(
    () =>
      buildShellNav(MODULES, (p) => packs[p] === true)
        .flatMap((g) => g.items)
        .filter((n) => n.bottom !== false)
        .slice(0, 5),
    [packs],
  );
  if (items.length === 0) return null;
  return (
    <nav
      aria-label={t("contracts.shell.navBottom")}
      style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
      className="fixed inset-x-0 bottom-0 z-20 grid border-t border-rule bg-panel md:hidden"
    >
      {items.map((n) => (
        <Link
          key={n.to}
          to={n.to as never}
          activeOptions={{ exact: n.exact === true }}
          className="flex h-14 flex-col items-center justify-center gap-0.5 px-1 text-micro text-dim aria-[current=page]:font-semibold aria-[current=page]:text-act"
        >
          <n.icon width={19} height={19} />
          <span className="max-w-full truncate">{t(n.labelKey)}</span>
        </Link>
      ))}
    </nav>
  );
}
