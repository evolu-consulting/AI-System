// CR-137 · khuôn «bảng + khung chi tiết» cho màn quản trị Community (Yêu cầu tham gia, Báo cáo vi phạm): lọc trạng thái, bấm dòng ⇒ chi tiết
// (ngăn bên phải trên màn rộng; thay danh sách + nút Quay lại trên điện thoại — thuần CSS). Rỗng ⇒ `EmptyState` web-kit.
import { EmptyState } from "@ai/web-kit/ui/EmptyState";
import { type ReactNode, useEffect, useState } from "react";
import {
  countByStatus,
  filterByStatus,
  keepSelection,
  type StatusFilter,
  sortForReview,
} from "../../domain/admin-list";
import { t } from "../../i18n";

export type Column<T> = { key: string; head: string; cell: (row: T) => ReactNode };
type Row = { id: string; status: string; createdAt: string };

type Props<T extends Row, S extends string> = {
  testId: string;
  rowTestId: string;
  rows: T[];
  statuses: readonly S[];
  pendingStatus: S;
  statusLabel: (s: S) => string;
  columns: Column<T>[];
  detail: (row: T) => ReactNode;
  detailTitle: string;
  emptyKey: string;
};

const WIDE = "(min-width: 900px)";

export function AdminList<T extends Row, S extends string>(p: Props<T, S>) {
  const [filter, setFilter] = useState<StatusFilter<S>>("all");
  const [sel, setSel] = useState<string | null>(null);
  const shown = sortForReview(filterByStatus(p.rows, filter), p.pendingStatus);
  const counts = countByStatus(p.rows);
  const current = keepSelection(shown, sel);
  // Màn rộng: tự mở dòng đầu để khung chi tiết không trống; điện thoại: chỉ mở khi người dùng bấm.
  useEffect(() => {
    if (current === null && shown[0] && window.matchMedia?.(WIDE).matches) setSel(shown[0].id);
  }, [current, shown]);
  if (p.rows.length === 0)
    return <EmptyState kind="empty" title={t(p.emptyKey)} testId={`${p.testId}-empty`} />;
  const row = shown.find((r) => r.id === current);
  return (
    <div className={`adminlist${row ? " has-detail" : ""}`} data-testid={p.testId}>
      <div className="adminlist-list card">
        <fieldset
          className="chips adminlist-filter"
          aria-label={t("community.flows.common.filterAria")}
        >
          {(["all", ...p.statuses] as StatusFilter<S>[]).map((s) => (
            <button
              key={s}
              type="button"
              className={filter === s ? "chip on" : "chip"}
              aria-pressed={filter === s}
              data-testid={`${p.testId}-filter-${s}`}
              onClick={() => setFilter(s)}
            >
              {s === "all" ? t("community.flows.common.filterAll") : p.statusLabel(s)}{" "}
              <span className="muted tnum">{s === "all" ? p.rows.length : (counts[s] ?? 0)}</span>
            </button>
          ))}
        </fieldset>
        {shown.length === 0 ? (
          <p className="muted adminlist-none">{t("community.flows.common.emptyFiltered")}</p>
        ) : (
          <div className="ptable-wrap">
            <table className="ptable adminlist-table">
              <thead>
                <tr>
                  {p.columns.map((c) => (
                    <th key={c.key} scope="col" className={`c-${c.key}`}>
                      {c.head}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr
                    key={r.id}
                    data-testid={p.rowTestId}
                    data-status={r.status}
                    aria-selected={r.id === current}
                    className={r.id === current ? "on" : undefined}
                    onClick={() => setSel(r.id)}
                  >
                    {p.columns.map((c, i) => (
                      <td key={c.key} className={`c-${c.key}`}>
                        {i === 0 ? (
                          <button
                            type="button"
                            className="adminlist-open"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSel(r.id);
                            }}
                          >
                            {c.cell(r)}
                          </button>
                        ) : (
                          c.cell(r)
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {row && (
        <aside
          className="adminlist-detail card"
          aria-label={p.detailTitle}
          data-testid={`${p.testId}-detail`}
        >
          <div className="adminlist-detailhead">
            <button type="button" className="ghost adminlist-back" onClick={() => setSel(null)}>
              {t("community.flows.common.back")}
            </button>
            <h2>{p.detailTitle}</h2>
          </div>
          {p.detail(row)}
        </aside>
      )}
    </div>
  );
}
