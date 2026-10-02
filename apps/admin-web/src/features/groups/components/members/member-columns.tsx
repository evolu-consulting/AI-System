// ADM-FR-62 · M3-R03 · cột bảng thành viên: người dùng (tên + username mono), group khác (chip key), đăng nhập cuối, bỏ khỏi group.
import type { GroupMember } from "@ai/contracts";
import type { TFunction } from "i18next";
import { X } from "lucide-react";
import type { Column } from "@/components/shared/DataTable";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { formatLastLogin, type Translate } from "@/lib/format";

type Opts = {
  t: TFunction;
  tr: Translate;
  onRemove: (userId: string, username: string) => void;
};

function OtherGroups({ m }: { m: GroupMember }) {
  return (
    <span className="flex flex-wrap gap-1">
      {m.other_groups.slice(0, 2).map((g) => (
        <StatusBadge key={g.id} tone="off">
          <span className="font-mono">{g.key}</span>
        </StatusBadge>
      ))}
      {m.other_groups_total > 2 ? (
        <StatusBadge tone="off">+{m.other_groups_total - 2}</StatusBadge>
      ) : null}
    </span>
  );
}

export function memberColumns({ t, tr, onRemove }: Opts): Column<GroupMember>[] {
  return [
    {
      id: "user",
      header: t("groups.members.col.user"),
      cell: (m) => (
        <>
          {m.display_name}{" "}
          <span className="font-mono text-label text-muted-foreground">{m.username}</span>{" "}
          {m.status === "locked" || m.locked_by_tenant ? (
            <StatusBadge tone="err">{t("users.status.locked")}</StatusBadge>
          ) : null}
        </>
      ),
    },
    { id: "other", header: t("groups.members.col.other"), cell: (m) => <OtherGroups m={m} /> },
    {
      id: "login",
      header: t("groups.members.col.lastLogin"),
      cell: (m) =>
        m.last_login_at ? (
          formatLastLogin(m.last_login_at, new Date(), tr)
        ) : (
          <StatusBadge tone="warn">{t("users.neverLoggedIn")}</StatusBadge>
        ),
    },
    {
      id: "remove",
      header: <span className="sr-only">{t("common.actions")}</span>,
      className: "w-12 text-right",
      cell: (m) => (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("groups.members.remove.aria", { username: m.username })}
          onClick={() => onRemove(m.user_id, m.username)}
        >
          <X aria-hidden />
        </Button>
      ),
    },
  ];
}
