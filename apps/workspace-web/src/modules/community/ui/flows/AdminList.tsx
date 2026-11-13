// CR-137 · CR-137b · khuôn «bảng + hộp thoại chi tiết» cho màn quản trị Community (Yêu cầu tham gia, Báo cáo vi phạm):
// bảng chiếm hết chiều ngang, lọc trạng thái; bấm dòng ⇒ hộp thoại chi tiết + thao tác. Rỗng ⇒ `EmptyState` web-kit.
import { EmptyState } from "@ai/web-kit/ui/EmptyState";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { useApp } from "../../application/ctx";
import { filterByStatus, type StatusFilter, sortForReview } from "../../domain/admin-list";
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
  detail: (row: T, close: () => void) => ReactNode;
  detailTitle: string;
  emptyKey: string;
};

export function AdminList<T extends Row, S extends string>(p: Props<T, S>) {
  const { brandAccent } = useApp();
  const [filter, setFilter] = useState<StatusFilter<S>>("all");
  const [sel, setSel] = useState<string | null>(null);
  const openedStatus = useRef<string | null>(null);
  const shown = sortForReview(filterByStatus(p.rows, filter), p.pendingStatus);
  const row = p.rows.find((r) => r.id === sel) ?? null;
  // Xử lý xong (trạng thái đổi so với lúc mở) hoặc dòng biến mất ⇒ tự đóng hộp thoại.
  useEffect(() => {
    if (sel !== null && (!row || (openedStatus.current && row.status !== openedStatus.current)))
      setSel(null);
  }, [sel, row]);
  if (p.rows.length === 0)
    return <EmptyState kind="empty" title={t(p.emptyKey)} testId={`${p.testId}-empty`} />;
  const open = (r: T) => {
    openedStatus.current = r.status;
    setSel(r.id);
  };
  return (
    <div className="adminlist" data-testid={p.testId}>
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
              {s === "all" ? t("community.flows.common.filterAll") : p.statusLabel(s)}
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
                    onClick={() => open(r)}
                  >
                    {p.columns.map((c, i) => (
                      <td key={c.key} className={`c-${c.key}`}>
                        {i === 0 ? (
                          <button
                            type="button"
                            className="adminlist-open"
                            onClick={(e) => {
                              e.stopPropagation();
                              open(r);
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
      <Dialog open={row !== null} onOpenChange={(o) => !o && setSel(null)}>
        {row && (
          <DialogContent aria-describedby={undefined} data-testid={`${p.testId}-detail`}>
            <div data-mod="community" data-accent={brandAccent}>
              <DialogHeader>
                <DialogTitle>{p.detailTitle}</DialogTitle>
              </DialogHeader>
              {p.detail(row, () => setSel(null))}
            </div>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
