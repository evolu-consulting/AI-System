// ADM-FR-54 · M4-AC09 · chip đếm Thêm / Sửa / Không đổi = nút lọc `aria-pressed` (plan-frontend §3.5 Import 2).
import type { ImportSummary as Summary } from "@ai/contracts";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

export type ImportFilter = "add" | "update" | "unchanged";

type Props = {
  summary: Summary;
  filter: ImportFilter | null;
  onFilter: (f: ImportFilter | null) => void;
};

const CHIPS: { f: ImportFilter; key: string; field: keyof Summary }[] = [
  { f: "add", key: "transfer.import.added", field: "added" },
  { f: "update", key: "transfer.import.updated", field: "updated" },
  { f: "unchanged", key: "transfer.import.unchanged", field: "unchanged" },
];

export function ImportSummary({ summary, filter, onFilter }: Props) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap gap-2">
      {CHIPS.map((c) => {
        const on = filter === c.f;
        return (
          <Button
            key={c.f}
            type="button"
            size="sm"
            variant={on ? "default" : "outline"}
            aria-pressed={on}
            onClick={() => onFilter(on ? null : c.f)}
          >
            {t(c.key, { n: summary[c.field] })}
          </Button>
        );
      })}
    </div>
  );
}
