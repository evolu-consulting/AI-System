// ADM-FR-35 · ADM-FR-32 · M3-R08, R09 · lưới feature × group: cuộn hai chiều, cột đầu và hàng tiêu đề dính, cửa sổ hoá (≤ ~240 ô trong DOM).
// biome-ignore-all lint/a11y/useSemanticElements: lưới ảo hoá (cửa sổ hoá hai chiều) không dùng được <table>/<input>; role đặt đúng theo WAI-ARIA grid/checkbox
// biome-ignore-all lint/a11y/noStaticElementInteractions: onKeyDown ở vùng cuộn của role=grid để điều hướng ô bằng mũi tên (ủy quyền sự kiện từ ô checkbox)
import type { MatrixFeature, MatrixGroup } from "@ai/contracts";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useGridWindow } from "../../hooks/use-grid-window";
import type { Draft, MatrixModel } from "../../lib/matrix";
import { onGridKeyDown } from "./grid-keys";
import type { TipState } from "./MatrixCell";
import { MatrixHeader } from "./MatrixHeader";
import { MatrixRow } from "./MatrixRow";
import { MatrixTip } from "./MatrixTip";

type Props = {
  model: MatrixModel;
  draft: Draft;
  showUnopened: boolean;
  onCell: (f: MatrixFeature, g: MatrixGroup) => void;
  onRow: (f: MatrixFeature) => void;
  onCol: (g: MatrixGroup) => void;
};

export function GrantMatrix({ model, draft, showUnopened, onCell, onRow, onCol }: Props) {
  const { t } = useTranslation();
  const [tip, setTip] = useState<TipState | null>(null);
  // Hàng "Chưa mở" (feature chưa có entitlement) ẩn mặc định (D11).
  const rows = model.features.filter((f) => showUnopened || f.state !== "none");
  const cols = model.groups.length;
  const w = useGridWindow(rows.length, cols);
  return (
    <div
      ref={w.ref}
      onScroll={w.onScroll}
      onKeyDown={(e) => onGridKeyDown(e, rows.length, cols)}
      className="relative max-h-[70vh] overflow-auto rounded-lg border border-border bg-card"
    >
      <div
        role="grid"
        aria-label={t("access.matrix.aria")}
        aria-rowcount={rows.length + 1}
        aria-colcount={cols + 1}
        className="relative"
        style={{ width: w.totalW, height: w.totalH }}
      >
        <MatrixHeader model={model} draft={draft} cols={w.cols} width={w.totalW} onCol={onCol} />
        {rows.slice(w.rows.start, w.rows.end).map((f, i) => (
          <MatrixRow
            key={f.feature.id}
            f={f}
            r={w.rows.start + i}
            model={model}
            draft={draft}
            cols={w.cols}
            width={w.totalW}
            firstRow={i === 0}
            onCell={onCell}
            onRow={onRow}
            onTip={setTip}
          />
        ))}
      </div>
      <MatrixTip tip={tip} />
    </div>
  );
}
