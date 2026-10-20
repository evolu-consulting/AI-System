// PK-FR-10 · TF5 · nav-v2 · thanh trái theo mockup NITI: khối tên app + công ty, 4 mục, tài khoản ở chân. Ghim mở 224 px (mặc định) hoặc
// thu thành cột biểu tượng 64 px (nút ở thanh trên); trạng thái nhớ theo trình duyệt (`nav:pinned`).
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { cn } from "~/lib/utils";
import { NAV, type NavItem, type Role } from "../lib/nav";
import { BrandMark } from "./BrandMark";
import { type ShellUser, UserMenu } from "./UserMenu";

function SideLink({ n, wide }: { n: NavItem; wide: boolean }) {
  const { t } = useTranslation();
  return (
    <Link
      to={n.to}
      title={wide ? undefined : t(n.labelKey)}
      className="flex h-11 items-center gap-3 overflow-hidden rounded-[10px] px-3 text-body whitespace-nowrap text-ink-2 transition-colors hover:bg-sunk aria-[current=page]:bg-act-soft aria-[current=page]:font-semibold aria-[current=page]:text-act"
    >
      <n.icon className="shrink-0" />
      <span className={wide ? "" : "sr-only"}>{t(n.labelKey)}</span>
    </Link>
  );
}

export function Sidebar({
  user,
  role,
  pinned,
  onLogout,
}: {
  user: ShellUser;
  role: Role;
  pinned: boolean;
  onLogout: () => Promise<void>;
}) {
  const { t } = useTranslation();
  return (
    <nav
      aria-label={t("contracts.shell.navMain")}
      className={cn(
        "z-30 flex h-dvh shrink-0 flex-col gap-1 border-r border-rule bg-panel px-2.5 py-3 transition-[width] duration-150 max-md:hidden",
        pinned ? "w-56" : "w-16",
      )}
    >
      <Link
        to="/overview"
        className="mb-2 flex h-10 items-center gap-2.5 overflow-hidden px-1.5"
        title={t("contracts.app.name")}
        aria-label={t("contracts.app.name")}
      >
        <BrandMark name={user?.tenant.name} />
        {pinned && (
          <span className="min-w-0 leading-tight">
            <span className="block text-[15.5px] font-bold tracking-tight whitespace-nowrap">
              {t("contracts.app.name")}
            </span>
            <span className="block truncate text-micro text-dim">{user?.tenant.name}</span>
          </span>
        )}
      </Link>
      {NAV.map((n) => (
        <SideLink key={n.to} n={n} wide={pinned} />
      ))}
      <div className="mt-auto flex flex-col gap-1 pt-2">
        <UserMenu user={user} role={role} onLogout={onLogout} side wide={pinned} />
      </div>
    </nav>
  );
}
