// ADM-FR-62 · M3-R13 · cột Groups của bảng Users: tối đa 2 chip (tên group) + chip "+n" (tooltip liệt kê phần còn lại); trống → "—".
import type { GroupRef } from "@ai/contracts";
import { useTranslation } from "react-i18next";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { pickLocalized } from "@/lib/localized";

type Props = { groups: GroupRef[]; total: number };

export function UserGroupChips({ groups, total }: Props) {
  const { t, i18n } = useTranslation();
  if (total === 0 || groups.length === 0) return <span className="text-muted-foreground">—</span>;
  const name = (g: GroupRef) => pickLocalized(g.name, i18n.language);
  const rest = groups.slice(2);
  return (
    <span className="flex flex-wrap gap-1">
      {groups.slice(0, 2).map((g) => (
        <StatusBadge key={g.id} tone={g.is_beta ? "info" : "off"}>
          <span className="max-w-24 truncate">{name(g)}</span>
        </StatusBadge>
      ))}
      {total > 2 ? (
        <StatusBadge
          tone="off"
          tooltip={t("users.groups.more", { names: rest.map(name).join(", ") })}
        >
          +{total - 2}
        </StatusBadge>
      ) : null}
    </span>
  );
}
