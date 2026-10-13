// HUB-FR-68 · cột "Được dùng bởi": badge mỗi tham chiếu (`type · key`), rỗng → "Chưa dùng".
import type { SecretUsedBy } from "@ai/contracts/hub-admin";
import { useTranslation } from "react-i18next";
import { Badge } from "#/components/ui/badge";
import { usedByLabel } from "../lib/used-by";

export function UsedByList({ items }: { items: readonly SecretUsedBy[] }) {
  const { t } = useTranslation();
  return (
    <span className="flex flex-wrap gap-1">
      {items.map((u) => (
        <Badge key={`${u.type}:${u.id}`} variant="secondary">
          {usedByLabel(t, u)}
        </Badge>
      ))}
    </span>
  );
}

export function UsedByCell({ items }: { items: readonly SecretUsedBy[] }) {
  const { t } = useTranslation();
  return items.length === 0 ? (
    <span className="text-muted-foreground">{t("secrets.usedBy.none")}</span>
  ) : (
    <UsedByList items={items} />
  );
}
