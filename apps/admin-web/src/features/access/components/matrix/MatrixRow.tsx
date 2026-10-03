// ADM-FR-35 · M3-R09 · một hàng feature của lưới: nhãn dính trái (ô tick cả hàng, tên, nhãn trạng thái, command) + các ô trong cửa sổ cột.
// biome-ignore-all lint/a11y/useSemanticElements: lưới ảo hoá (cửa sổ hoá hai chiều) không dùng được <table>/<input>; role đặt đúng theo WAI-ARIA grid/checkbox
// biome-ignore-all lint/a11y/useFocusableInteractive: row/gridcell không tương tác; phím điều hướng nằm ở ô checkbox bên trong (roving tabindex)
import type { MatrixFeature, MatrixGroup } from "@ai/contracts";
import { memo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { pickLocalized } from "@/lib/localized";
import { GRID, type Range } from "../../lib/grid-window";
import { cellChecked, type Draft, isEditable, type MatrixModel, rowState } from "../../lib/matrix";
import { LineCheckbox } from "./LineCheckbox";
import { MatrixCell, type TipState } from "./MatrixCell";

type Props = {
  f: MatrixFeature;
  r: number;
  model: MatrixModel;
  draft: Draft;
  cols: Range;
  width: number;
  /** Cột của ô có tabindex=0 trong hàng này (-1: không có) — roving tabindex theo ô vừa focus. */
  tabC: number;
  /** Cột đang hiện tooltip trong hàng này (-1: không). */
  tipC: number;
  onCell: (f: MatrixFeature, g: MatrixGroup) => void;
  onRow: (f: MatrixFeature) => void;
  onTip: (tip: TipState | null) => void;
};

function RowBadges({ f, dirty }: { f: MatrixFeature; dirty: boolean }) {
  const { t } = useTranslation();
  return (
    <>
      {f.state === "core" ? (
        <StatusBadge tone="info">{t("access.matrix.badge.default")}</StatusBadge>
      ) : null}
      {f.state === "none" ? (
        <StatusBadge tone="off">{t("access.matrix.badge.notOpened")}</StatusBadge>
      ) : null}
      {f.state === "revoked" ? (
        <StatusBadge tone="warn">{t("access.matrix.revoked")}</StatusBadge>
      ) : null}
      {f.feature.status === "beta" ? (
        <StatusBadge tone="info">{t("access.matrix.badge.beta")}</StatusBadge>
      ) : null}
      {dirty ? <StatusBadge tone="warn">{t("access.matrix.badge.unsaved")}</StatusBadge> : null}
    </>
  );
}

function tipFor(t: (k: string) => string, f: MatrixFeature, checked: boolean): string {
  if (f.state === "core") return t("access.matrix.tip.core");
  if (f.state === "none") return t("access.matrix.tip.notOpened");
  return t(checked ? "access.matrix.tip.on" : "access.matrix.tip.off");
}

function MatrixRowImpl({
  f,
  r,
  model,
  draft,
  cols,
  width,
  tabC,
  tipC,
  onCell,
  onRow,
  onTip,
}: Props) {
  const { t, i18n } = useTranslation();
  const name = pickLocalized(f.feature.name, i18n.language);
  const prefix = `${f.feature.id}:`;
  const dirty = [...draft.keys()].some((k) => k.startsWith(prefix));
  const locked = !isEditable(f);
  const commands = f.command_names.map((n) => `/${n}`).join(", ");
  const groups = model.groups;
  // Ổn định qua các lần tick (chỉ đổi khi feature/danh sách group đổi) để `MatrixCell` memo hiệu quả.
  const toggleAt = useCallback(
    (_r: number, c: number) => onCell(f, groups[c] as MatrixGroup),
    [onCell, f, groups],
  );
  return (
    <div
      role="row"
      aria-rowindex={r + 2}
      className={
        locked ? "absolute border-b border-border bg-muted/30" : "absolute border-b border-border"
      }
      style={{ top: GRID.headH + r * GRID.rowH, height: GRID.rowH, width }}
    >
      <div
        role="rowheader"
        aria-colindex={1}
        className="sticky left-0 z-10 flex items-center gap-2 border-r border-border bg-card px-4"
        style={{ width: GRID.labelW, height: GRID.rowH }}
      >
        {locked ? (
          <span className="size-5 shrink-0" />
        ) : (
          <LineCheckbox
            label={t("access.matrix.rowAll", { feature: name })}
            state={rowState(model, draft, f)}
            onToggle={() => onRow(f)}
          />
        )}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate font-medium">{name}</span>
            <RowBadges f={f} dirty={dirty} />
          </div>
          {commands ? (
            <p className="truncate font-mono text-caption text-muted-foreground">{commands}</p>
          ) : null}
        </div>
      </div>
      {model.groups.slice(cols.start, cols.end).map((g, i) => {
        const c = cols.start + i;
        const checked = cellChecked(model, draft, f, g);
        return (
          <div
            key={g.id}
            role="gridcell"
            aria-colindex={c + 2}
            className="absolute top-0 flex items-center"
            style={{ left: GRID.labelW + c * GRID.colW, width: GRID.colW, height: GRID.rowH }}
          >
            <MatrixCell
              r={r}
              c={c}
              label={t("access.matrix.cell", {
                feature: name,
                group: pickLocalized(g.name, i18n.language),
              })}
              checked={checked}
              locked={locked}
              dirty={!locked && checked !== model.granted.has(`${prefix}${g.id}`)}
              tabbable={c === tabC}
              described={c === tipC}
              tip={tipFor(t, f, checked)}
              onToggle={toggleAt}
              onTip={onTip}
            />
          </div>
        );
      })}
    </div>
  );
}

export const MatrixRow = memo(MatrixRowImpl);
