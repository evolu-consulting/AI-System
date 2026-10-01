// ADM-FR-60, ADM-FR-04 · phân trang server: "1–50 / 120" + Trước/Sau (`nav` có nhãn).
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

type Props = {
  offset: number;
  limit: number;
  total: number;
  onOffsetChange: (offset: number) => void;
};

export function Pagination({ offset, limit, total, onOffsetChange }: Props) {
  const { t } = useTranslation();
  if (total === 0) return null;
  const from = offset + 1;
  const to = Math.min(offset + limit, total);
  return (
    <nav aria-label={t("common.pagination.aria")} className="flex items-center justify-end gap-3">
      <span className="text-label text-muted-foreground">
        {t("common.pagination.range", { from, to, total })}
      </span>
      <Button
        variant="outline"
        size="sm"
        disabled={offset <= 0}
        onClick={() => onOffsetChange(Math.max(0, offset - limit))}
      >
        {t("common.pagination.prev")}
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={offset + limit >= total}
        onClick={() => onOffsetChange(offset + limit)}
      >
        {t("common.pagination.next")}
      </Button>
    </nav>
  );
}
