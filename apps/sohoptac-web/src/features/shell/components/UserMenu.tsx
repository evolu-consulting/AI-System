// PK-FR-10 · TF5 · S16 menu người dùng: tên, công ty, vai (viewer/editor/owner), Cài đặt (chỉ người ghi), Đăng xuất.

import { PrefsPanel } from "@ai/web-kit/ui/PrefsPanel";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { IconLogout, IconSettings } from "~/components/icons";
import { confirmDialog } from "~/components/shared/dialog-bus";
import { nameOf, useBrand } from "~/features/settings/lib/brand";
import { openSettings } from "~/features/settings/lib/bus";

import { canSeeSettings, type Role } from "../lib/nav";
import { AccountLinks, LegalLinks } from "./AccountSection";
import { Popover } from "./Popover";

export type ShellUser = {
  display_name: string;
  username: string;
  email: string | null;
  tenant: { name: string };
  /** Vai ở tenant (`tenant_admin` mở được Thành viên & phòng ban). */
  role?: string;
} | null;

const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(-2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

type BodyProps = {
  user: NonNullable<ShellUser>;
  role: Role;
  name: string;
  company: string;
  close: () => void;
  onLogout: () => Promise<void>;
};

function MenuBody({ user, role, name, company, close, onLogout }: BodyProps) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  return (
    <>
      <div className="border-b border-rule px-4 py-3">
        <p className="text-body font-semibold">{name}</p>
        {user.email && <p className="text-caption text-dim">{user.email}</p>}
        <p className="mt-1 text-caption">
          {company} · <span className="text-act">{t(`contracts.shell.role.${role}`)}</span>
        </p>
      </div>
      <PrefsPanel />
      <AccountLinks role={user.role} close={close} />
      {canSeeSettings(role, user.role) && (
        <>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              close();
              openSettings();
            }}
            className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-label hover:bg-sunk"
          >
            <IconSettings width={18} height={18} /> {t("contracts.shell.settings")}
          </button>
          <Link
            to="/settings"
            role="menuitem"
            onClick={close}
            className="flex items-center gap-2.5 px-4 py-2.5 text-label hover:bg-sunk"
          >
            <IconSettings width={18} height={18} /> {t("contracts.settings.more")}
          </Link>
        </>
      )}
      <button
        type="button"
        role="menuitem"
        className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-label text-late hover:bg-sunk"
        onClick={async () => {
          const ok = await confirmDialog({
            title: t("contracts.shell.logoutTitle"),
            body: t("contracts.shell.logoutBody"),
            confirmLabel: t("contracts.shell.logout"),
            danger: true,
          });
          if (!ok) return;
          close();
          await onLogout().catch(() => null);
          qc.clear();
        }}
      >
        <IconLogout width={18} height={18} /> {t("contracts.shell.logout")}
      </button>
      <LegalLinks close={close} />
    </>
  );
}

/** `side`: chân sidebar (tên chỉ hiện khi thanh mở); mặc định: thanh trên ở điện thoại. */
export function UserMenu({
  user,
  role,
  onLogout,
  side = false,
  wide = true,
}: {
  user: ShellUser;
  role: Role;
  onLogout: () => Promise<void>;
  side?: boolean;
  wide?: boolean;
}) {
  const { t } = useTranslation();
  const brand = useBrand();
  if (!user) return null;
  const company = nameOf(brand, user.tenant.name);
  const name = user.display_name || user.username;
  return (
    <Popover
      label={t("contracts.shell.account")}
      role="menu"
      up={side}
      full={side}
      button={
        <>
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-act-soft text-caption font-semibold text-act">
            {initials(name)}
          </span>
          <span
            className={`min-w-0 flex-col items-start leading-tight ${wide ? "flex" : "hidden"} ${side ? "" : "max-md:hidden"}`}
          >
            <span className="max-w-full truncate text-label font-semibold text-ink">{name}</span>
            <span className="max-w-full truncate text-micro text-dim">
              {company} · {t(`contracts.shell.role.${role}`)}
            </span>
          </span>
        </>
      }
    >
      {(close) => (
        <MenuBody
          user={user}
          role={role}
          name={name}
          company={company}
          close={close}
          onLogout={onLogout}
        />
      )}
    </Popover>
  );
}
