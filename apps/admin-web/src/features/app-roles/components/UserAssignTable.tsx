// CR-112 · ADM-FR-82 · bảng gán người dùng nội bộ vào vai: Người dùng | Vai hệ thống | Vai theo ứng dụng | Quyền thực tế | Kiểm tra quyền.
// Đối tác không có trong bảng (`kind=internal`, ADM-BR-16). Gán/gỡ ghi vào bản nháp; quyền thực tế tính lại theo nháp.
import type { User } from "@ai/contracts/users";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { SearchBox } from "@/components/shared/form/SearchBox";
import { Pagination } from "@/components/shared/Pagination";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { EmptyState } from "@/components/shared/states/EmptyState";
import { ErrorState } from "@/components/shared/states/ErrorState";
import { LoadingState } from "@/components/shared/states/LoadingState";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ApiError } from "@/lib/http";
import { USERS_PAGE, useRoleUsers } from "../api";
import type { RolesDraft } from "../hooks/use-roles-draft";
import { levelsFromRoles } from "../lib/effective";
import { LEVEL_KEY, packNameKey } from "../lib/levels";
import { rolesOfUser } from "../lib/view";
import { UserRoleCell } from "./UserRoleCell";

type Props = { tenantId: string | undefined; draft: RolesDraft; onCheck: (user: User) => void };

function EffectiveCell({ levels }: { levels: ReturnType<typeof levelsFromRoles> }) {
  const { t } = useTranslation();
  if (levels.length === 0)
    return <span className="text-muted-foreground">{t("appRoles.user.none")}</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {levels.map((l) => {
        const key = packNameKey(l.pack);
        const app = key ? t(key) : l.pack;
        return l.level ? (
          <StatusBadge key={l.pack} tone="ok">
            {app}: {t(LEVEL_KEY[l.level])}
          </StatusBadge>
        ) : (
          <StatusBadge key={l.pack} tone="warn">
            {app}: {t("appRoles.ineffective.label")}
          </StatusBadge>
        );
      })}
    </div>
  );
}

export function UserAssignTable({ tenantId, draft, onCheck }: Props) {
  const { t } = useTranslation();
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const users = useRoleUsers({ tenantId, q, offset }, true);
  const err = users.error instanceof ApiError ? users.error : null;
  const rows = users.data?.items ?? [];
  return (
    <section aria-label={t("appRoles.users.title")} className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-h3 font-semibold">{t("appRoles.users.title")}</h2>
          <p className="text-caption text-muted-foreground">{t("appRoles.users.desc")}</p>
        </div>
        <SearchBox
          label={t("appRoles.users.search")}
          value={q}
          onChange={(v) => {
            setQ(v);
            setOffset(0);
          }}
        />
      </div>
      {users.isPending ? <LoadingState /> : null}
      {users.error ? (
        <ErrorState
          message={err?.message ?? ""}
          code={err?.code ?? "NETWORK_ERROR"}
          onRetry={() => void users.refetch()}
        />
      ) : null}
      {users.data && rows.length === 0 ? <EmptyState message={t("appRoles.users.empty")} /> : null}
      {rows.length > 0 ? (
        <Table aria-label={t("appRoles.users.tableAria")}>
          <TableHeader>
            <TableRow>
              <TableHead>{t("appRoles.users.col.user")}</TableHead>
              <TableHead>{t("appRoles.users.col.system")}</TableHead>
              <TableHead>{t("appRoles.users.col.roles")}</TableHead>
              <TableHead>{t("appRoles.users.col.effective")}</TableHead>
              <TableHead className="text-right">{t("appRoles.users.col.check")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((u) => {
              const groupIds = new Set(u.groups.map((g) => g.id));
              const mine = rolesOfUser(u.id, groupIds, draft.views, draft.staged);
              return (
                <TableRow key={u.id}>
                  <TableCell>
                    {u.display_name}{" "}
                    <span className="font-mono text-label text-muted-foreground">{u.username}</span>
                  </TableCell>
                  <TableCell className="font-mono text-label">{u.role}</TableCell>
                  <TableCell>
                    <UserRoleCell
                      user={u}
                      mine={mine}
                      all={draft.views}
                      savedGroupIds={groupIds}
                      onToggle={(ref, saved, want) => draft.setMember(ref, u.id, saved, want)}
                    />
                  </TableCell>
                  <TableCell>
                    <EffectiveCell levels={levelsFromRoles(mine)} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label={t("appRoles.users.checkAria", { user: u.username })}
                      onClick={() => onCheck(u)}
                    >
                      {t("appRoles.users.check")}
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      ) : null}
      <Pagination
        offset={offset}
        limit={USERS_PAGE}
        total={users.data?.total ?? 0}
        onOffsetChange={setOffset}
      />
    </section>
  );
}
