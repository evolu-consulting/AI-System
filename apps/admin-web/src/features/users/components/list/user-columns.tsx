// ADM-FR-04 · ADM-FR-62 · cột bảng Users: tên đăng nhập (mono, "(bạn)"), [Tenant], tên hiển thị, role, Groups, đăng nhập gần nhất, trạng thái, menu `⋯`.
import type { User } from "@ai/contracts";
import type { TFunction } from "i18next";
import { MoreHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Column } from "@/components/shared/DataTable";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatClock, formatLastLogin, type Translate } from "@/lib/format";
import { rowActions, type UserActionKind, userStatusView } from "../../lib/status";
import { UserGroupChips } from "./UserGroupChips";

function StatusCell({ user }: { user: User }) {
  const { t } = useTranslation();
  const view = userStatusView(user, new Date());
  if (view.kind === "locked") {
    return (
      <StatusBadge
        tone="err"
        tooltip={view.byTenant ? t("users.lockedByTenant", { tenant: user.tenant_key }) : undefined}
      >
        {t("users.status.locked")}
      </StatusBadge>
    );
  }
  if (view.kind === "tempLocked") {
    return (
      <StatusBadge tone="warn">
        {t("users.status.tempLocked", { time: formatClock(view.until) })}
      </StatusBadge>
    );
  }
  return <StatusBadge tone="ok">{t("users.status.active")}</StatusBadge>;
}

function RowMenu({
  user,
  isSelf,
  onEdit,
  onAction,
}: Pick<ColumnOpts, "onEdit" | "onAction"> & { user: User; isSelf: boolean }) {
  const { t } = useTranslation();
  const a = rowActions(user, isSelf, new Date());
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={t("common.moreActions")}>
          <MoreHorizontal aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => onEdit(user)}>{t("users.menu.edit")}</DropdownMenuItem>
        {a.resetPassword ? (
          <DropdownMenuItem onSelect={() => onAction("reset", user)}>
            {t("users.menu.resetPassword")}
          </DropdownMenuItem>
        ) : null}
        {a.lock ? (
          <DropdownMenuItem onSelect={() => onAction("lock", user)}>
            {t("users.menu.lock")}
          </DropdownMenuItem>
        ) : null}
        {a.unlock ? (
          <DropdownMenuItem disabled={!a.unlockEnabled} onSelect={() => onAction("unlock", user)}>
            {t("users.menu.unlock")}
          </DropdownMenuItem>
        ) : null}
        {a.logoutAll ? (
          <DropdownMenuItem onSelect={() => onAction("logoutAll", user)}>
            {t("users.menu.logoutAll")}
          </DropdownMenuItem>
        ) : null}
        {a.disable2fa ? (
          <DropdownMenuItem onSelect={() => onAction("disable2fa", user)}>
            {t("users.menu.disable2fa")}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export type ColumnOpts = {
  t: TFunction;
  tr: Translate;
  selfId: string;
  showTenant: boolean;
  onEdit: (u: User) => void;
  onAction: (kind: UserActionKind, u: User) => void;
};

function identityColumns({ t, selfId, showTenant }: ColumnOpts): Column<User>[] {
  const cols: Column<User>[] = [
    {
      id: "username",
      header: t("users.col.username"),
      cell: (u) => (
        <span className="font-mono">
          {u.username}
          {u.id === selfId ? <> {t("common.you")}</> : null}
        </span>
      ),
    },
  ];
  if (showTenant) {
    cols.push({
      id: "tenant",
      header: t("users.col.tenant"),
      cell: (u) => <span className="font-mono">{u.tenant_key}</span>,
    });
  }
  cols.push(
    { id: "name", header: t("users.col.displayName"), cell: (u) => u.display_name },
    {
      id: "role",
      header: t("users.col.role"),
      cell: (u) => <span className="font-mono text-label">{u.role}</span>,
    },
    {
      id: "groups",
      header: t("users.col.groups"),
      cell: (u) => <UserGroupChips groups={u.groups} total={u.group_count} />,
    },
  );
  return cols;
}

function stateColumns({ t, tr, selfId, onEdit, onAction }: ColumnOpts): Column<User>[] {
  return [
    {
      id: "login",
      header: t("users.col.lastLogin"),
      cell: (u) =>
        u.last_login_at ? (
          formatLastLogin(u.last_login_at, new Date(), tr)
        ) : (
          <StatusBadge tone="warn">{t("users.neverLoggedIn")}</StatusBadge>
        ),
    },
    { id: "status", header: t("users.col.status"), cell: (u) => <StatusCell user={u} /> },
    {
      id: "actions",
      header: <span className="sr-only">{t("common.actions")}</span>,
      className: "w-12 text-right",
      cell: (u) => (
        <RowMenu user={u} isSelf={u.id === selfId} onEdit={onEdit} onAction={onAction} />
      ),
    },
  ];
}

export function userColumns(opts: ColumnOpts): Column<User>[] {
  return [...identityColumns(opts), ...stateColumns(opts)];
}
