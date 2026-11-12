// PK-FR-10 · TF5 · nav-v2 · CR-120 · thanh trái CỦA MỘT AppShell: khối công ty (logo + tên), các nhóm menu SINH TỪ MANIFEST các module
// (`shell/nav.ts`), tài khoản ở chân. Mọi mục là `<Link>` của TanStack (điều hướng trong app, không tải lại, không biểu tượng liên kết ngoài).
// Ghim mở 224 px (mặc định) hoặc thu thành cột biểu tượng 64 px (nút ở thanh trên); trạng thái nhớ theo trình duyệt (`nav:pinned`).
import { Link, useLinkProps } from "@tanstack/react-router";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useUnreadTotal } from "~/features/messages/hooks/use-unread";
import { useInbox } from "~/features/overview/hooks/use-inbox";
import { appNameOf, nameOf, useBrand } from "~/features/settings/lib/brand";
import { cn } from "~/lib/utils";
import type { NavEntry } from "~/shared/kernel/module-manifest";
import { MODULES } from "~/shell/modules";
import { activeEntry, buildShellNav, type ShellNavGroup } from "~/shell/nav";
import { badgeText, useFlowCaps } from "~/shell/use-flow-caps";
import { useNavPath } from "~/shell/use-nav-path";
import { useShellPacks } from "~/shell/use-shell-packs";
import type { Role } from "../lib/nav";
import { BrandMark } from "./BrandMark";
import { type ShellUser, UserMenu } from "./UserMenu";

/** CR-121 C-6 · cỡ + nét biểu tượng menu do Sidebar quyết định (module không tự chọn): mọi module cùng 20 px / 1.8. */
export const NAV_ICON_PX = 20;
export const NAV_ICON_STROKE = 1.8;

export function NavIcon({ icon: Icon }: { icon: NavEntry["icon"] }) {
  return (
    <Icon
      className="shrink-0"
      width={NAV_ICON_PX}
      height={NAV_ICON_PX}
      strokeWidth={NAV_ICON_STROKE}
    />
  );
}

/** CR-121 C-7 · badge 16 px (cùng kiểu chuông ở Header): 0 ⇒ không có; trên 99 ⇒ "99+". */
export function NavBadge({ count, className }: { count: number; className?: string }) {
  const { t } = useTranslation();
  const text = badgeText(count);
  if (!text) return null;
  return (
    <span
      data-testid="nav-badge"
      role="img"
      aria-label={t("contracts.nav.pending", { n: count })}
      className={cn(
        "grid h-4 min-w-4 place-items-center rounded-full bg-late px-1 text-micro font-semibold text-panel",
        className,
      )}
    >
      {text}
    </span>
  );
}

function SideLink({
  n,
  wide,
  current,
  count,
}: {
  n: NavEntry;
  wide: boolean;
  current: boolean;
  count: number;
}) {
  const { t } = useTranslation();
  // `<Link>` tự đặt aria-current theo route ĐÃ COMMIT (trễ tới khi trang lười tải xong) ⇒ lấy props rồi ghi đè theo đường dẫn đích (một nguồn).
  const linkProps = useLinkProps({
    to: n.to as never,
    activeOptions: { exact: n.exact === true },
  }) as React.ComponentProps<"a">;
  return (
    <a
      {...linkProps}
      aria-current={current ? "page" : undefined}
      data-status={current ? "active" : undefined}
      data-testid={n.testId}
      data-nav-item={n.to}
      title={wide ? undefined : t(n.labelKey)}
      className="flex h-11 items-center gap-3 overflow-hidden rounded-[10px] px-3 text-body whitespace-nowrap text-ink-2 transition-colors hover:bg-sunk aria-[current=page]:bg-act-soft aria-[current=page]:font-semibold aria-[current=page]:text-act"
    >
      <span className="relative shrink-0">
        <NavIcon icon={n.icon} />
        {!wide && <NavBadge count={count} className="absolute -top-1.5 -right-1.5" />}
      </span>
      <span className={wide ? "" : "sr-only"}>{t(n.labelKey)}</span>
      {wide && <NavBadge count={count} className="ml-auto" />}
    </a>
  );
}

/** CR-126 · số đỏ «Việc của tôi» = số dòng hộp việc (một hook với trang). */
function InboxLink(p: { n: NavEntry; wide: boolean; current: boolean }) {
  return <SideLink {...p} count={useInbox().count} />;
}

/** CR-132 · số đỏ «Tin nhắn» = tổng chưa đọc (cùng một query với nút khoang; mục chỉ có khi module có gói). */
function UnreadLink(p: { n: NavEntry; wide: boolean; current: boolean }) {
  return <SideLink {...p} count={useUnreadTotal()} />;
}

function Group({
  g,
  wide,
  pathname,
  first,
  badgeOf,
}: {
  g: ShellNavGroup;
  wide: boolean;
  pathname: string;
  first: boolean;
  badgeOf: (cap: string) => number;
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
      {g.items.map((n) =>
        n.inbox ? (
          <InboxLink key={n.to} n={n} wide={wide} current={on === n} />
        ) : n.unread ? (
          <UnreadLink key={n.to} n={n} wide={wide} current={on === n} />
        ) : (
          <SideLink
            key={n.to}
            n={n}
            wide={wide}
            current={on === n}
            count={n.cap ? badgeOf(n.cap) : 0}
          />
        ),
      )}
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
  const pathname = useNavPath();
  const packs = useShellPacks();
  const { hasCap, badgeOf } = useFlowCaps(
    packs.community === true || packs.contracts === true,
    pathname,
  );
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
      data-testid="shell-sidebar"
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
        <Group
          key={g.key}
          g={g}
          wide={pinned}
          pathname={pathname}
          first={i === 0}
          badgeOf={badgeOf}
        />
      ))}
      <div className="mt-auto flex flex-col gap-1 pt-2">
        <UserMenu user={user} role={role} onLogout={onLogout} side wide={pinned} />
      </div>
    </nav>
  );
}
