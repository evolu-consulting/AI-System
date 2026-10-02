// ADM-FR-62 · A11 · ô Groups trong drawer sửa user: CHỈ ĐỌC (`list "Groups"`, chip link tới /groups/<id>); sửa thành viên ở trang Group.
import type { GroupRef } from "@ai/contracts";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { pickLocalized } from "@/lib/localized";

export function UserGroupsField({ groups }: { groups: GroupRef[] }) {
  const { t, i18n } = useTranslation();
  return (
    <div className="mt-6 space-y-1.5">
      <p className="text-label font-medium">{t("users.col.groups")}</p>
      {groups.length === 0 ? (
        <p className="text-body text-muted-foreground">{t("users.field.groupsNone")}</p>
      ) : (
        <ul aria-label={t("users.col.groups")} className="flex flex-wrap gap-2">
          {groups.map((g) => (
            <li key={g.id}>
              <Link
                to="/groups/$groupId"
                params={{ groupId: g.id }}
                className="inline-flex rounded-full border border-border px-2.5 py-0.5 text-label underline-offset-4 hover:underline"
              >
                {pickLocalized(g.name, i18n.language)}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="text-caption text-muted-foreground">{t("users.field.groupsReadonly")}</p>
    </div>
  );
}
