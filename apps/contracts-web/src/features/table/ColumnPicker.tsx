// PK-FR-10 · TF6 · "Cột ▾": hộp chọn cho mỗi cột, cùng kiểu viên thuốc với bộ lọc. Nguồn: table.tsx:310-334.
import { useTranslation } from "react-i18next";
import { cn } from "~/lib/utils";
import { Caret, PILL, PILL_OFF, PILL_ON, Pop } from "./Pop";
import type { Columns } from "./use-columns";

export function ColumnPicker({ cols }: { cols: Columns }) {
  const { t } = useTranslation();
  return (
    <Pop
      align="right"
      button={(open, toggle) => (
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-label={t("contracts.table.columnsAria")}
          className={cn(PILL, cols.hiddenCount ? PILL_ON : PILL_OFF)}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" className="opacity-70">
            <path
              d="M1.5 2.5h11v9h-11zM5.2 2.5v9M8.8 2.5v9"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
            />
          </svg>
          {cols.hiddenCount
            ? t("contracts.table.columnsHidden", { n: cols.hiddenCount })
            : t("contracts.table.columns")}
          <Caret />
        </button>
      )}
    >
      {cols.columns.map((c) => (
        <label
          key={c.key}
          className={cn(
            "flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13.5px]",
            c.locked ? "text-dim" : "cursor-pointer hover:bg-sunk",
          )}
        >
          <input
            type="checkbox"
            checked={cols.shows(c.key)}
            disabled={c.locked}
            onChange={() => cols.toggle(c.key)}
            className="h-4 w-4 accent-[var(--color-act)]"
          />
          {c.label}
        </label>
      ))}
      {cols.hiddenCount > 0 && (
        <div className="mt-1 border-t border-rule-soft px-1 pt-1.5">
          <button
            type="button"
            className="text-caption text-act hover:underline"
            onClick={cols.reset}
          >
            {t("contracts.table.showAll")}
          </button>
        </div>
      )}
    </Pop>
  );
}
