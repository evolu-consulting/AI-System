// DOC-ui-list · R31/R32: bộ lọc loại chứng từ của "Hợp đồng & giao dịch" — Tất cả / HĐ nguyên tắc / HĐ kinh tế / Giao dịch, kèm số.
import { useTranslation } from "react-i18next";
import { SegButton } from "~/components/shared/seg-button";
import { cn } from "~/lib/utils";
import { DOC_FILTERS, type DocFilter } from "../lib/doc-list";

export function DocTypeFilter({
  value,
  counts,
  onChange,
}: {
  value: DocFilter;
  counts: Partial<Record<DocFilter, number>>;
  onChange: (f: DocFilter) => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      role="radiogroup"
      aria-label={t("contracts.doclist.filterLabel")}
      data-testid="doc-type-filter"
      className="mb-3 flex flex-wrap gap-2"
    >
      {DOC_FILTERS.map((f) => {
        const on = f === value;
        const n = counts[f];
        return (
          <SegButton
            key={f}
            checked={on}
            onClick={() => onChange(f)}
            className={cn(
              "rounded-full border px-3.5 py-1.5 text-[13.5px]",
              on
                ? "border-act bg-act-soft font-semibold text-act"
                : "border-rule bg-panel hover:border-act-line",
            )}
          >
            {t(`contracts.doclist.filter.${f}`)}
            {n !== undefined && <span className="ml-1.5 text-dim">{n}</span>}
          </SegButton>
        );
      })}
    </div>
  );
}
