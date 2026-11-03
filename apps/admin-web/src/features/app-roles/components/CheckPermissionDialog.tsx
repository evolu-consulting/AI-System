// CR-112 · ADM-FR-82 (AC5) · ADM-FR-36 · "Kiểm tra quyền" của một người: mức thực tế theo từng app + nguồn (vai / "quyền ngoài vai" từ
// Group phòng ban / gán lẻ). Dựng từ `GET /admin/users/:id/effective-access` (đã có), không có API tính riêng.
import type { AppRole, User } from "@ai/contracts";
import { useTranslation } from "react-i18next";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { EmptyState } from "@/components/shared/states/EmptyState";
import { ErrorState } from "@/components/shared/states/ErrorState";
import { LoadingState } from "@/components/shared/states/LoadingState";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useEffectiveAccess } from "@/features/access/api";
import { ApiError } from "@/lib/http";
import { pickLocalized } from "@/lib/localized";
import { type ExplainSource, explainPacks } from "../lib/effective";
import { LEVEL_KEY, packNameKey, roleLabel, sortPacks } from "../lib/levels";
import { LevelBadge } from "./LevelBadge";

type Props = {
  user: Pick<User, "id" | "username" | "display_name">;
  roles: AppRole[];
  onClose: () => void;
};

function SourceLine({ s, roles }: { s: ExplainSource; roles: AppRole[] }) {
  const { t, i18n } = useTranslation();
  const role = roles.find((r) => r.group_id === s.groupId);
  const roleName = role
    ? (() => {
        const l = roleLabel(
          { isDefault: role.is_default, key: role.key, name: role.name },
          i18n.language,
        );
        return "key" in l ? t(l.key) : l.text;
      })()
    : "";
  const group = s.groupName ? pickLocalized(s.groupName, i18n.language) : "";
  const text =
    s.kind === "role"
      ? t("appRoles.check.viaRole", { role: roleName })
      : s.kind === "outside"
        ? t("appRoles.check.outside", { group })
        : t("appRoles.check.direct");
  return (
    <li className="flex flex-wrap items-center gap-2 text-body">
      <span>{text}</span>
      <span className="text-muted-foreground">· {t(LEVEL_KEY[s.level])}</span>
      {s.kind === "outside" ? (
        <StatusBadge tone="info">{t("appRoles.check.outsideBadge")}</StatusBadge>
      ) : null}
      {s.effective ? null : (
        <StatusBadge tone="warn">{t("appRoles.ineffective.label")}</StatusBadge>
      )}
    </li>
  );
}

export function CheckPermissionDialog({ user, roles, onClose }: Props) {
  const { t } = useTranslation();
  const access = useEffectiveAccess(user.id);
  const err = access.error instanceof ApiError ? access.error : null;
  const packs = sortPacks([...new Set(roles.map((r) => r.pack))]);
  const roleGroups = new Set(roles.map((r) => r.group_id));
  const rows = access.data ? explainPacks(access.data, packs, roleGroups) : [];
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("appRoles.check.title", { user: user.display_name })}</DialogTitle>
          <DialogDescription>
            {t("appRoles.check.desc", { username: user.username })}
          </DialogDescription>
        </DialogHeader>
        {access.isPending ? <LoadingState /> : null}
        {access.error ? (
          <ErrorState
            message={err?.message ?? ""}
            code={err?.code ?? "NETWORK_ERROR"}
            onRetry={() => void access.refetch()}
          />
        ) : null}
        {access.data && rows.length === 0 ? (
          <EmptyState message={t("appRoles.check.empty")} />
        ) : null}
        <div className="space-y-4">
          {rows.map((r) => {
            const key = packNameKey(r.pack);
            return (
              <section
                key={r.pack}
                aria-label={key ? t(key) : r.pack}
                className="space-y-1.5 rounded-md border border-border p-3"
              >
                <h3 className="flex items-center gap-2 font-semibold">
                  {key ? t(key) : r.pack}
                  {r.level ? (
                    <LevelBadge level={r.level} />
                  ) : (
                    <StatusBadge tone="off">{t("appRoles.check.noAccess")}</StatusBadge>
                  )}
                </h3>
                {r.sources.length === 0 ? (
                  <p className="text-caption text-muted-foreground">
                    {t("appRoles.check.noSource")}
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {r.sources.map((s) => (
                      <SourceLine key={`${s.kind}-${s.groupId ?? "u"}`} s={s} roles={roles} />
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
