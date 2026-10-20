// V2-E · BA v2 §5.1j · §6 ("Đổi Cài đặt: điểm các kỳ đã chốt giữ nguyên"): vòng chốt điểm hằng tháng. Một lượt một tenant
// (`system(tid)`, thấy cả tenant): kỳ = các tháng ĐÃ HẾT trong 12 tháng gần nhất chưa có lượt chốt (lần đầu ⇒ điền lùi 12 kỳ cho biểu
// đồ 12 tháng); mỗi kỳ = MỘT câu chấm theo tập (hôm nay = ngày cuối tháng) + MỘT câu ghi (hàng chốt + lượt chạy, `on conflict do
// nothing`) ⇒ kỳ đã chốt không bao giờ tính lại, hai vòng chạy chồng không ghi đôi. Cấu hình đọc một lần mỗi lượt.
import type { PackSystemUow } from "../../kit/application/ports";
import { localDate } from "../domain/local-time.rules";
import { lockRows } from "../domain/rep-board.rules";
import { resolveConfig } from "../domain/rep-normalise.rules";
import type { RepRepo } from "./reputation.ports";
import { cellsOf, historyFrom } from "./reputation.usecase";

export type RepLockDeps = {
  uow: PackSystemUow<{ rep: RepRepo }>;
  tenants: () => Promise<readonly string[]>;
  timeZoneOf: (tenantId: string) => Promise<string>;
  now: () => Date;
  log?: { warn(msg: string, meta: Record<string, unknown>): void };
};
export const LOCK_BACKFILL_MONTHS = 12;

/** Ngày cuối tháng của kỳ `YYYY-MM-01`. */
export function monthEnd(period: string): string {
  const [y, m] = period.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}
/** Các kỳ đã hết (đầu tháng) từ `from` tới tháng trước `today`, tăng dần. */
export function periodsBetween(from: string, today: string): string[] {
  const out: string[] = [];
  const end = `${today.slice(0, 7)}-01`;
  for (let p = from; p < end; ) {
    out.push(p);
    const [y, m] = p.split("-").map(Number) as [number, number];
    p = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  }
  return out;
}

export function createRepLockSweep(d: RepLockDeps) {
  /** Chốt mọi kỳ còn thiếu của một tenant; trả số kỳ vừa chốt. */
  const once = async (tenantId: string): Promise<number> => {
    const today = localDate(d.now(), await d.timeZoneOf(tenantId));
    const from = historyFrom(today, LOCK_BACKFILL_MONTHS);
    const [done, stored] = await d.uow.system(tenantId, async (r) => {
      const periods = await r.rep.lockedPeriods(from);
      return [periods, await r.rep.configs()] as const;
    });
    const cfg = resolveConfig(stored);
    const todo = periodsBetween(from, today).filter((p) => !done.includes(p));
    for (const p of todo)
      await d.uow.system(tenantId, async (r) => {
        const rows = await r.rep.scoreRows(monthEnd(p), cellsOf(cfg), null);
        await r.rep.insertLocks(p, lockRows(rows, cfg));
      });
    return todo.length;
  };
  /** Mọi tenant; lỗi một tenant không chặn tenant khác. */
  const drain = async (): Promise<number> => {
    let total = 0;
    for (const tid of await d.tenants()) {
      try {
        total += await once(tid);
      } catch (e) {
        d.log?.warn("contracts-rep-lock-tenant-failed", { tenantId: tid, error: String(e) });
      }
    }
    return total;
  };
  return { once, drain };
}
export type RepLockSweep = ReturnType<typeof createRepLockSweep>;
