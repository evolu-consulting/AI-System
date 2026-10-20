// PK-FR-10 · TF5 · thanh trên 58 px: tiêu đề mục (desktop) / tên app (điện thoại), chuông, giao diện, góp ý, tài khoản (điện thoại).
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { IconFeedback } from "~/components/icons";
import { ConnectedBell } from "~/features/notifications/components/ConnectedBell";
import { EXTRA_NAV, type NavItem, type Role } from "../lib/nav";
import { Logo } from "./Logo";
import { type ShellUser, UserMenu } from "./UserMenu";

export function Header({
  here,
  user,
  role,
  onFeedback,
  onLogout,
}: {
  onLogout: () => Promise<void>;
  here: NavItem | undefined;
  user: ShellUser;
  role: Role;
  onFeedback: () => void;
}) {
  const { t } = useTranslation();
  return (
    <header className="flex h-[58px] shrink-0 items-center gap-3 border-b border-rule bg-panel px-5 max-md:px-3">
      <Link to="/contracts" className="flex items-center gap-2 md:hidden">
        <Logo className="h-7 w-7" />
        <span className="text-card-title font-bold tracking-tight">{t("contracts.app.name")}</span>
      </Link>
      <h1 className="text-[15px] font-semibold max-md:hidden">{here ? t(here.labelKey) : null}</h1>
      <div className="ml-auto flex items-center gap-1">
        <nav
          data-w1-nav=""
          aria-label={t("contracts.shell.navExtra")}
          className="flex items-center gap-1 md:hidden"
        >
          {EXTRA_NAV.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              aria-label={t(n.labelKey)}
              title={t(n.labelKey)}
              className="grid h-10 w-10 place-items-center rounded-lg text-ink-2 hover:bg-sunk aria-[current=page]:text-act"
            >
              <n.icon />
            </Link>
          ))}
        </nav>
        <ConnectedBell />
        <button
          type="button"
          onClick={onFeedback}
          aria-label={t("contracts.shell.feedback")}
          title={t("contracts.shell.feedback")}
          className="grid h-10 w-10 place-items-center rounded-lg text-ink-2 hover:bg-sunk"
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
