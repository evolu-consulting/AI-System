// PK-FR-10 · TF5 · nav-v2 · thanh trên 52 px theo mockup NITI: nút thu/mở thanh trái (desktop) hoặc tên app (điện thoại), chuông, góp ý,
// tài khoản (điện thoại). Không còn tiêu đề mục — mỗi trang tự có H1.
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { IconFeedback, IconSidebar } from "~/components/icons";
import { ConnectedBell } from "~/features/notifications/components/ConnectedBell";
import { appNameOf, nameOf, useBrand } from "~/features/settings/lib/brand";
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
  const brand = useBrand();
  const toggle = t(pinned ? "contracts.shell.navCollapse" : "contracts.shell.navExpand");
  return (
    <header className="flex h-[52px] shrink-0 items-center gap-3 border-b border-rule bg-panel px-5 max-md:px-3">
      <Link to="/overview" className="flex items-center gap-2 md:hidden">
        <BrandMark
          name={nameOf(brand, user?.tenant.name)}
          logo={brand.logo}
          className="h-7 w-7 text-[13px]"
        />
        <span className="text-card-title font-bold tracking-tight">
          {appNameOf(brand, t("contracts.app.name"))}
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
      <div className="ml-auto flex items-center gap-1">
        <AppSwitcher role={user?.role} userId={user?.username} />
        <ConnectedBell />
        <button
          type="button"
          onClick={onFeedback}
          aria-label={t("contracts.shell.feedback")}
          title={t("contracts.shell.feedback")}
          className={BTN}
        >
          <IconFeedback />
        </button>
        <span className="md:hidden">
          <UserMenu user={user} role={role} onLogout={onLogout} />
        </span>
      </div>
    </header>
  );
}
