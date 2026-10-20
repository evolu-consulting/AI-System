// PK-FR-10 · TF5 · thanh trái: biểu tượng 64 px, mở 224 px khi rê chuột / focus (nổi trên trang). Nguồn: mgmt-app Shell.tsx Sidebar.
import { Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "~/lib/utils";
import { EXTRA_NAV, MAIN_NAV, type NavItem, type Role } from "../lib/nav";
import { Logo } from "./Logo";
import { type ShellUser, UserMenu } from "./UserMenu";

function SideLink({ n, wide, onPick }: { n: NavItem; wide: boolean; onPick: () => void }) {
  const { t } = useTranslation();
  return (
    <Link
      to={n.to}
      title={wide ? undefined : t(n.labelKey)}
      onClick={onPick}
      className="flex h-11 items-center gap-3 whitespace-nowrap rounded-lg px-3 text-body text-ink-2 transition-colors hover:bg-sunk aria-[current=page]:bg-act-soft aria-[current=page]:font-semibold aria-[current=page]:text-act"
    >
      <n.icon className="shrink-0" />
      <span className={wide ? "" : "sr-only"}>{t(n.labelKey)}</span>
    </Link>
  );
}

export function Sidebar({
  user,
  role,
  onLogout,
}: {
  user: ShellUser;
  role: Role;
  onLogout: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [wide, setWide] = useState(false);
  // Bấm một mục thì thanh thu lại và giữ thu tới khi chuột rời (như mgmt-app); còn lại, chuột chạm/di trong thanh là mở.
  const picked = useRef(false);
  const pick = () => {
    picked.current = true;
    setWide(false);
  };
  const open = () => {
    if (!picked.current) setWide(true);
  };
  return (
    // Thanh giữ 64 px trong bố cục; bản mở nổi lên trên trang.
    <div className="relative h-dvh w-16 shrink-0 max-md:hidden">
      <nav
        aria-label={t("contracts.shell.navMain")}
        onMouseEnter={open}
        onMouseMove={open}
        onMouseLeave={() => {
          picked.current = false;
          setWide(false);
        }}
        onFocus={() => setWide(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setWide(false);
        }}
        className={cn(
          "absolute inset-y-0 left-0 z-30 flex flex-col gap-1 border-r border-rule bg-panel px-2.5 py-3 transition-[width] duration-150",
          wide ? "w-56 shadow-drawer" : "w-16",
        )}
      >
        <Link
          to="/contracts"
          className="mb-3 flex h-10 items-center gap-2.5 overflow-hidden px-1.5"
          title={t("contracts.app.name")}
          aria-label={t("contracts.app.name")}
        >
          <Logo className="h-8 w-8 shrink-0" />
          {wide && (
            <span className="min-w-0 leading-tight">
              <span className="block text-[15.5px] font-bold tracking-tight">
                {t("contracts.app.name")}
              </span>
              <span className="block truncate text-micro text-dim">
                {t("contracts.app.tagline")}
              </span>
            </span>
          )}
        </Link>
        {MAIN_NAV.map((n) => (
          <SideLink key={n.to} n={n} wide={wide} onPick={pick} />
        ))}
        <div data-w1-nav="" className="mt-2 flex flex-col gap-1 border-t border-rule pt-2">
          {EXTRA_NAV.map((n) => (
            <SideLink key={n.to} n={n} wide={wide} onPick={pick} />
          ))}
        </div>
        <div className="mt-auto flex flex-col gap-1 border-t border-rule pt-2">
          <UserMenu user={user} role={role} onLogout={onLogout} side wide={wide} />
        </div>
      </nav>
    </div>
  );
}
