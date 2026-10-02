// ADM-FR-24 · M3-R14 · cột "Group được cấp" của tab Ai dùng được: tối đa 3 chip "tên group · feature" + "+n group nữa"; trống → "Chưa group nào được cấp".
import type { CommandAccessItem } from "@ai/contracts";
import { useTranslation } from "react-i18next";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { pickLocalized } from "@/lib/localized";

const SHOWN = 3;

export function AccessGroups({ item }: { item: CommandAccessItem }) {
  const { t, i18n } = useTranslation();
  if (item.groups.length === 0) {
    return <span className="text-muted-foreground">{t("commands.access.groups.none")}</span>;
  }
  const rest = item.group_count - SHOWN;
  return (
    <span className="flex flex-wrap gap-1">
      {item.groups.slice(0, SHOWN).map((g) => (
        <StatusBadge key={`${g.id}:${g.feature.id}`} tone={g.is_beta ? "info" : "off"}>
          {`${pickLocalized(g.name, i18n.language)} · ${pickLocalized(g.feature.name, i18n.language)}`}
        </StatusBadge>
      ))}
      {rest > 0 ? (
        <span className="text-label text-muted-foreground">
          {t("commands.access.groups.more", { count: rest })}
        </span>
      ) : null}
    </span>
  );
}
