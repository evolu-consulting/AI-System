// ADM-FR-35 · M3-R09 · hàng tiêu đề lưới (dính trên): góc "Feature" + tên group kèm ô tick cả cột; chỉ dựng các cột trong cửa sổ.
// biome-ignore-all lint/a11y/useSemanticElements: lưới ảo hoá (cửa sổ hoá hai chiều) không dùng được <table>/<input>; role đặt đúng theo WAI-ARIA grid/checkbox
// biome-ignore-all lint/a11y/useFocusableInteractive: row/gridcell không tương tác; phím điều hướng nằm ở ô checkbox bên trong (roving tabindex)
import type { MatrixGroup } from "@ai/contracts";
import { useTranslation } from "react-i18next";
import { pickLocalized } from "@/lib/localized";
import { GRID, type Range } from "../../lib/grid-window";
import { colState, type Draft, type MatrixModel } from "../../lib/matrix";
import { LineCheckbox } from "./LineCheckbox";

type Props = {
  model: MatrixModel;
  draft: Draft;
  cols: Range;
  width: number;
  onCol: (g: MatrixGroup) => void;
};

export function MatrixHeader({ model, draft, cols, width, onCol }: Props) {
  const { t, i18n } = useTranslation();
  return (
    <div
      role="row"
      aria-rowindex={1}
      className="sticky top-0 z-20 border-b border-border bg-card"
      style={{ height: GRID.headH, width }}
    >
      <div
        role="columnheader"
        aria-colindex={1}
        className="sticky left-0 z-10 flex items-center border-r border-border bg-card px-4 text-label font-semibold"
        style={{ width: GRID.labelW, height: GRID.headH }}
      >
        {t("groups.col.features")}
      </div>
      {model.groups.slice(cols.start, cols.end).map((g, i) => {
        const c = cols.start + i;
        const name = pickLocalized(g.name, i18n.language);
        return (
          <div
            key={g.id}
            role="columnheader"
            aria-colindex={c + 2}
            className="absolute top-0 flex flex-col items-center justify-center gap-1 px-1"
            style={{ left: GRID.labelW + c * GRID.colW, width: GRID.colW, height: GRID.headH }}
          >
            <LineCheckbox
              label={t("access.matrix.colAll", { group: name })}
              state={colState(model, draft, g)}
              onToggle={() => onCol(g)}
            />
            <span className="w-full truncate text-center text-caption" title={name}>
              {name}
            </span>
          </div>
        );
      })}
    </div>
  );
}
