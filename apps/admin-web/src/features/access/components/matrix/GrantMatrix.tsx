// ADM-FR-35 · ADM-FR-32 · M3-R08, R09 · lưới feature × group: cuộn hai chiều, cột đầu và hàng tiêu đề dính, cửa sổ hoá (≤ ~240 ô trong DOM).
// biome-ignore-all lint/a11y/useSemanticElements: lưới ảo hoá (cửa sổ hoá hai chiều) không dùng được <table>/<input>; role đặt đúng theo WAI-ARIA grid/checkbox
// biome-ignore-all lint/a11y/noStaticElementInteractions: onKeyDown ở vùng cuộn của role=grid để điều hướng ô bằng mũi tên (ủy quyền sự kiện từ ô checkbox)
import type { MatrixFeature, MatrixGroup } from "@ai/contracts";
import type { FocusEvent } from "react";
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
  const [focus, setFocus] = useState({ r: 0, c: 0 });
  const onFocus = (e: FocusEvent<HTMLElement>) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-r][data-c]");
    if (el) setFocus({ r: Number(el.dataset.r), c: Number(el.dataset.c) });
  };
  // Ô vừa focus còn trong cửa sổ → giữ tabindex=0 ở đó; ngược lại về ô đầu cửa sổ.
  const inWin =
    focus.r >= w.rows.start &&
    focus.r < w.rows.end &&
    focus.c >= w.cols.start &&
    focus.c < w.cols.end;
  const tab = inWin ? focus : { r: w.rows.start, c: w.cols.start };
  return (
    <div
      ref={w.ref}
      onScroll={w.onScroll}
      onFocus={onFocus}
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
            tabC={tab.r === w.rows.start + i ? tab.c : -1}
            tipC={tip && tip.r === w.rows.start + i ? tip.c : -1}
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
