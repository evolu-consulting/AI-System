// ADM-FR-75 · cột bảng tài khoản của một công ty đối tác: tên đăng nhập, tên hiển thị, email, trạng thái, đăng nhập gần nhất, menu `⋯`.
import type { User } from "@ai/contracts";
import type { TFunction } from "i18next";
import { MoreHorizontal } from "lucide-react";
import type { Column } from "@/components/shared/DataTable";
import { StatusBadge, type StatusTone } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatLastLogin, type Translate } from "@/lib/format";
import {
  type PartnerUserActionKind,
  type PartnerUserStatus,
  partnerUserActions,
  partnerUserStatus,
} from "../lib/status";

export type PartnerUserColumnOpts = {
  t: TFunction;
  tr: Translate;
  orgActive: boolean;
  onAction: (kind: PartnerUserActionKind, u: User) => void;
};

const TONE: Record<PartnerUserStatus, StatusTone> = {
  active: "ok",
  locked: "err",
  deactivated: "off",
};
const STATUS_KEY = {
  active: "partners.user.status.active",
  locked: "partners.user.status.locked",
  deactivated: "partners.user.status.deactivated",
} as const;

const MENU = [
  ["resetPassword", "partners.user.menu.resetPassword"],
  ["lock", "partners.user.menu.lock"],
  ["unlock", "partners.user.menu.unlock"],
  ["deactivate", "partners.user.menu.deactivate"],
] as const;

function RowMenu({
  user,
  t,
  orgActive,
  onAction,
}: Omit<PartnerUserColumnOpts, "tr"> & { user: User }) {
  const allowed = partnerUserActions(user, orgActive, new Date());
  const items = MENU.filter(([kind]) => allowed[kind]);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("common.moreActions")}
          disabled={items.length === 0}
        >
          <MoreHorizontal aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {items.map(([kind, key]) => (
          <DropdownMenuItem key={kind} onSelect={() => onAction(kind, user)}>
            {t(key)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function partnerUserColumns(opts: PartnerUserColumnOpts): Column<User>[] {
  const { t, tr } = opts;
  return [
    {
      id: "username",
      header: t("partners.user.col.username"),
      cell: (u) => <span className="font-mono">{u.username}</span>,
    },
    { id: "name", header: t("partners.user.col.displayName"), cell: (u) => u.display_name },
    {
      id: "email",
      header: t("partners.user.col.email"),
      cell: (u) => u.email ?? <span className="text-muted-foreground">—</span>,
    },
    {
      id: "status",
      header: t("partners.user.col.status"),
      cell: (u) => {
        const s = partnerUserStatus(u, new Date());
        return <StatusBadge tone={TONE[s]}>{t(STATUS_KEY[s])}</StatusBadge>;
      },
    },
    {
      id: "login",
      header: t("partners.user.col.lastLogin"),
      cell: (u) =>
        u.last_login_at ? (
          formatLastLogin(u.last_login_at, new Date(), tr)
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: "actions",
      header: <span className="sr-only">{t("common.actions")}</span>,
      className: "w-12 text-right",
      cell: (u) => <RowMenu user={u} t={t} orgActive={opts.orgActive} onAction={opts.onAction} />,
    },
  ];
}
