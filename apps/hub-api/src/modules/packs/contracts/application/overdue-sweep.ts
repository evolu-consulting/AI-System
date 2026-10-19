// HD7-FR-09 · HD7-NFR-02 · HD7-NFR-03 · HD7 plan §3 · D7-10: vòng quá hạn theo tập — port `ledger/overdue.py::sweep` (viết lại
// theo tập: mgmt đọc 2.000 đợt vào Python rồi ghi từng hàng). Một lô = một tenant: `system(tid)` (set_config) + MỘT câu CTE khoá
// `SKIP LOCKED` ≤ `batchSize` đợt, ghi `overdue_for` + sổ. "Hôm nay" = ngày lịch múi tenant (HD4 `localDate`). Không chờ khoá
// (SKIP LOCKED) ⇒ không vòng chờ với lệnh ghi khoá HĐ → đợt.
import type { PackSystemUow } from "../../kit/application/ports";
import { localDate } from "../domain/local-time.rules";

export type OverdueRepo = {
  /** Ghi tối đa `limit` dòng quá hạn cho đợt có hạn < `today`; trả số dòng đã ghi. */
  sweep(today: string, limit: number): Promise<number>;
};

export type OverdueDeps = {
  uow: PackSystemUow<{ overdue: OverdueRepo }>;
  tenants: () => Promise<readonly string[]>;
  timeZoneOf: (tenantId: string) => Promise<string>;
  now: () => Date;
  batchSize: number;
  log?: { warn(msg: string, meta: Record<string, unknown>): void };
};

export function createOverdueSweepUsecase(d: OverdueDeps) {
  /** Một lô của một tenant. */
  const once = async (tenantId: string): Promise<number> => {
    const today = localDate(d.now(), await d.timeZoneOf(tenantId));
    return d.uow.system(tenantId, (r) => r.overdue.sweep(today, d.batchSize));
  };
  /** Mọi tenant, mỗi tenant tới khi lô cuối < `batchSize`. Lỗi một tenant không chặn tenant khác. */
  const drain = async (): Promise<number> => {
    let total = 0;
    for (const tid of await d.tenants()) {
      try {
        for (;;) {
          const n = await once(tid);
          total += n;
          if (n < d.batchSize) break;
        }
      } catch (e) {
        d.log?.warn("contracts-overdue-tenant-failed", { tenantId: tid, error: String(e) });
      }
    }
    return total;
  };
  return { once, drain };
}
export type OverdueSweep = ReturnType<typeof createOverdueSweepUsecase>;
