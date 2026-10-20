// PK-FR-10 · TF5 · S16 menu người dùng: tên, công ty, vai (viewer/editor/owner), Cài đặt (chỉ người ghi), Đăng xuất.

import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { IconLogout, IconSettings } from "~/components/icons";
import { confirmDialog } from "~/components/shared/dialog-bus";

import { canSeeSettings, type Role } from "../lib/nav";
import { Popover } from "./Popover";
import { ThemePicker } from "./ThemeMenu";

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
  const qc = useQueryClient();
  if (!user) return null;
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
              {user.tenant.name} · {t(`contracts.shell.role.${role}`)}
            </span>
          </span>
        </>
      }
    >
      {(close) => (
        <>
          <div className="border-b border-rule px-4 py-3">
            <p className="text-body font-semibold">{name}</p>
            {user.email && <p className="text-caption text-dim">{user.email}</p>}
            <p className="mt-1 text-caption">
              {user.tenant.name} ·{" "}
              <span className="text-act">{t(`contracts.shell.role.${role}`)}</span>
            </p>
          </div>
          <ThemePicker />
          {canSeeSettings(role, user.role) && (
            <Link
              to="/settings"
              role="menuitem"
              onClick={close}
              className="flex items-center gap-2.5 px-4 py-2.5 text-label hover:bg-sunk"
            >
              <IconSettings width={18} height={18} /> {t("contracts.shell.settings")}
            </Link>
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
        </>
      )}
    </Popover>
  );
}
