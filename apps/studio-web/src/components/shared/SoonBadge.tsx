// HUB-FR-72 · nhãn "Sắp có" cho mục/nút chưa làm (không route chết).
import { useTranslation } from "react-i18next";
import { Badge } from "#/components/ui/badge";

export type SoonKind = "soon" | "soonH4b" | "soonH4c";

export function SoonBadge({ kind = "soon" }: { kind?: SoonKind }) {
  const { t } = useTranslation();
  return <Badge variant="secondary">{t(kind)}</Badge>;
}
