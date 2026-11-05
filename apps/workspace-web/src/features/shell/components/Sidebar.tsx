// PK-FR-10 · TF5 · nav-v2 · CR-120 · thanh trái CỦA MỘT AppShell: khối công ty (logo + tên), các nhóm menu SINH TỪ MANIFEST các module
// (`shell/nav.ts`), tài khoản ở chân. Mọi mục là `<Link>` của TanStack (điều hướng trong app, không tải lại, không biểu tượng liên kết ngoài).
// Ghim mở 224 px (mặc định) hoặc thu thành cột biểu tượng 64 px (nút ở thanh trên); trạng thái nhớ theo trình duyệt (`nav:pinned`).
import { Link, useLocation } from "@tanstack/react-router";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { appNameOf, nameOf, useBrand } from "~/features/settings/lib/brand";
import { cn } from "~/lib/utils";
import type { NavEntry } from "~/shared/kernel/module-manifest";
import { MODULES } from "~/shell/modules";
import { activeEntry, buildShellNav, type ShellNavGroup } from "~/shell/nav";
import { useFlowCaps } from "~/shell/use-flow-caps";
import { useShellPacks } from "~/shell/use-shell-packs";
import type { Role } from "../lib/nav";
import { BrandMark } from "./BrandMark";
import { type ShellUser, UserMenu } from "./UserMenu";

function SideLink({ n, wide, current }: { n: NavEntry; wide: boolean; current: boolean }) {
  const { t } = useTranslation();
  return (
    <Link
      to={n.to as never}
      activeOptions={{ exact: n.exact === true }}
      aria-current={current ? "page" : undefined}
      data-testid={n.testId}
      title={wide ? undefined : t(n.labelKey)}
      className="flex h-11 items-center gap-3 overflow-hidden rounded-[10px] px-3 text-body whitespace-nowrap text-ink-2 transition-colors hover:bg-sunk aria-[current=page]:bg-act-soft aria-[current=page]:font-semibold aria-[current=page]:text-act"
    >
      <n.icon className="shrink-0" />
      <span className={wide ? "" : "sr-only"}>{t(n.labelKey)}</span>
    </Link>
  );
}

function Group({
  g,
  wide,
  pathname,
  first,
}: {
  g: ShellNavGroup;
  wide: boolean;
  pathname: string;
  first: boolean;
}) {
  const { t } = useTranslation();
  const on = activeEntry(g, pathname);
  return (
    <div data-testid={`nav-group-${g.key}`} className="flex flex-col gap-1">
      {wide ? (
        <p
          className={cn(
            "px-3 pt-3 pb-1 text-micro font-semibold tracking-wide text-dim uppercase",
            first && "pt-1",
          )}
        >
          {t(g.labelKey)}
        </p>
      ) : (
        !first && <hr className="mx-3 my-1.5 border-rule-soft" />
      )}
      {g.items.map((n) => (
        <SideLink key={n.to} n={n} wide={wide} current={on === n} />
      ))}
    </div>
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
  const { pathname } = useLocation();
  const packs = useShellPacks();
  const hasCap = useFlowCaps(packs.community === true, pathname);
  const groups = useMemo(
    () => buildShellNav(MODULES, (p) => packs[p] === true, hasCap),
    [packs, hasCap],
  );
  const brand = useBrand();
  const company = nameOf(brand, user?.tenant.name);
  // Tên sản phẩm chỉ hiện khi người dùng có gói contracts (đối tác không thấy tên "Sổ Hợp Tác" — I1/I3, HT-75/76).
  const app = packs.contracts ? appNameOf(brand, t("contracts.app.name")) : null;
  const home =
    groups.find((g) => pathname === g.basePath || pathname.startsWith(`${g.basePath}/`))?.items[0]
      ?.to ??
    groups[0]?.items[0]?.to ??
    "/contracts";
  return (
    <nav
      aria-label={t("contracts.shell.navMain")}
      className={cn(
        "z-30 flex h-dvh shrink-0 flex-col gap-1 border-r border-rule bg-panel px-2.5 py-3 transition-[width] duration-150 max-md:hidden",
        pinned ? "w-56" : "w-16",
      )}
    >
      <Link
        to={home as never}
        className="mb-2 flex h-10 items-center gap-2.5 overflow-hidden px-1.5"
        title={company}
        aria-label={app ?? company}
        data-testid="shell-brand"
      >
        <BrandMark name={company} logo={brand.logo} />
        {pinned && (
          <span className="min-w-0 leading-tight">
            <span className="block truncate text-[15.5px] font-bold tracking-tight">{company}</span>
            {app && <span className="block truncate text-micro text-dim">{app}</span>}
          </span>
        )}
      </Link>
      {groups.map((g, i) => (
        <Group key={g.key} g={g} wide={pinned} pathname={pathname} first={i === 0} />
      ))}
      <div className="mt-auto flex flex-col gap-1 pt-2">
        <UserMenu user={user} role={role} onLogout={onLogout} side wide={pinned} />
      </div>
    </nav>
  );
}
