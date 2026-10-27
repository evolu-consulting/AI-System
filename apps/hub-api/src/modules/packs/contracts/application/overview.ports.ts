// V2-K · TQ-01/TQ-02 · ADR-0023: cổng repo Tổng quan + Cần xử lý (lớp 2 — chỉ kiểu); `adapters/overview.repo.ts`,
// `adapters/todo.repo.ts` cài.
import type { MonthRow } from "../domain/overview.rules";
import type { RawTodo, TodoAction } from "../domain/todo.rules";

export type OverviewWindow = { from: string; to: string; profitFrom: string };
export type OverviewRaw = { months: MonthRow[]; stock: number };
export type OverviewRepo = { months(w: OverviewWindow): Promise<OverviewRaw> };

/** `quarter`: trong 30 ngày đầu quý ⇒ đầu quý này + quý trước (nguồn Đánh giá sau quý); ngoài ⇒ null. */
export type TodoWindow = {
  today: string;
  horizon: string;
  tz: string;
  quarter: { start: string; prevStart: string; prevEnd: string } | null;
  /** REP-v3 mục 7: nguồn "Đánh giá đối tác" (sau HĐ + sau quý) chỉ khi engine `v2e` (chấm sao mở); vắng ⇒ tắt. */
  rating?: boolean;
};
export type TodoRepo = {
  list(w: TodoWindow): Promise<RawTodo[]>;
  dismiss(key: string, action: TodoAction): Promise<void>;
};
