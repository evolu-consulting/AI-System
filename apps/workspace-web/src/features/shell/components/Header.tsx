// PK-FR-10 · TF5 · nav-v2 · CR-120 · thanh trên 52 px DÙNG CHUNG mọi module: nút thu/mở thanh trái (desktop) hoặc nhận diện công ty (điện
// thoại), KHE tìm kiếm của module đang mở (Community vẽ ô tìm vào đây), chuông (của module đang mở), công tắc sáng/tối, góp ý, tài khoản.
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { IconFeedback, IconSidebar } from "~/components/icons";
import { ConnectedBell } from "~/features/notifications/components/ConnectedBell";
import { nameOf, useBrand } from "~/features/settings/lib/brand";
import { topbarSlots } from "~/shell/topbar-slots";
import { searchOwner, useNavPath } from "~/shell/use-nav-path";
import { useShellPacks } from "~/shell/use-shell-packs";
import type { Role } from "../lib/nav";
import { AppSwitcher } from "./AppSwitcher";
import { BrandMark } from "./BrandMark";
import { type ShellUser, UserMenu } from "./UserMenu";

const BTN = "grid h-10 w-10 place-items-center rounded-[10px] text-ink-2 hover:bg-sunk";

export function Header({
  user,
  role,
  pinned,
  onTogglePinned,
  onFeedback,
  onLogout,
}: {
  onLogout: () => Promise<void>;
  user: ShellUser;
  role: Role;
  pinned: boolean;
  onTogglePinned: () => void;
  onFeedback: () => void;
}) {
  const { t } = useTranslation();
  const pathname = useNavPath();
  const brand = useBrand();
  const packs = useShellPacks();
  const inCommunity = pathname === "/community" || pathname.startsWith("/community/");
  const owner = searchOwner(pathname); // module đích sở hữu khe tìm: nội dung của module cũ (còn vẽ tới khi trang đích tải xong) bị ẩn ngay
  const toggle = t(pinned ? "contracts.shell.navCollapse" : "contracts.shell.navExpand");
  return (
    <header className="flex h-[52px] shrink-0 items-center gap-3 border-b border-rule bg-panel px-5 max-md:px-3">
      <Link
        to={(inCommunity ? "/community" : "/contracts") as never}
        className="flex items-center gap-2 md:hidden"
      >
        <BrandMark
          name={nameOf(brand, user?.tenant.name)}
          logo={brand.logo}
          className="h-7 w-7 text-[13px]"
        />
        <span className="max-w-[40vw] truncate text-card-title font-bold tracking-tight">
          {nameOf(brand, user?.tenant.name)}
        </span>
      </Link>
      <button
        type="button"
        onClick={onTogglePinned}
        aria-label={toggle}
        title={toggle}
        aria-pressed={pinned}
        className={`${BTN} max-md:hidden`}
      >
        <IconSidebar />
      </button>
      <div
        ref={(el) => topbarSlots.set("search", el)}
        data-slot="topbar-search"
        data-testid="topbar-search"
        data-owner={owner}
        className="flex min-w-0 flex-1 items-center gap-2 data-[owner=contracts]:hidden"
      />
      <div data-testid="topbar-actions" className="flex items-center gap-1">
        {packs.contracts && (
          <span data-testid="topbar-apps" className="flex items-center">
            <AppSwitcher role={user?.role} userId={user?.username} />
          </span>
        )}
        <span data-testid="topbar-bell" className="flex items-center">
          <span
            ref={(el) => topbarSlots.set("bell", el)}
            data-slot="topbar-bell"
            className="flex items-center"
          />
          {packs.contracts && !inCommunity && <ConnectedBell />}
        </span>
        {packs.contracts && (
          <button
            type="button"
            data-testid="topbar-feedback"
            onClick={onFeedback}
            aria-label={t("contracts.shell.feedback")}
            title={t("contracts.shell.feedback")}
            className={BTN}
          >
            <IconFeedback />
          </button>
        )}
        <span className="md:hidden">
          <UserMenu user={user} role={role} onLogout={onLogout} />
        </span>
      </div>
    </header>
  );
}
