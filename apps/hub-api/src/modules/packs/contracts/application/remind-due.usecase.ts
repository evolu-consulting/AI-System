// HD4-FR-03…05 · HD4-NFR-01 · D4-01 · D4-02 · plan §2: vòng nhắc theo tập. Một lô = một tenant: tìm tenant có việc tới hạn (role
// `contracts_job`), rồi trong tx `system(tenant)` claim ≤ `batchSize` hàng (SKIP LOCKED) → domain thuần → MỘT câu áp dụng
// (trạng thái, lịch, `contract_reminders`, event, outbox, `notify.enqueue`). Số câu mỗi lô cố định. `drain` chạy tới hết việc,
// bỏ qua tenant lỗi/đang bị instance khác khoá trong lượt đó (readiness #4), không sleep.
import { type DueContract, planReminder, type ReminderPlan } from "../domain/deadline.rules";

export type RemindApplied = { statusChanged: number; reminded: number; notified: number };
export type ReminderBatchRepo = {
  /** ≤ `limit` HĐ của tenant tx có `remind_at <= now`, khoá `FOR UPDATE SKIP LOCKED`. */
  claim(now: Date, limit: number): Promise<DueContract[]>;
  /** Xoá hàng lịch tới hạn không còn HĐ (mồ côi); trả số hàng xoá. */
  purgeOrphans(now: Date): Promise<number>;
  /** Một câu cho cả lô. */
  apply(plans: readonly ReminderPlan[]): Promise<RemindApplied>;
};
export type DueTenantFinder = {
  /** Tenant có hàng tới hạn sớm nhất, trừ `skip`; không còn ⇒ null. */
  next(now: Date, skip: readonly string[]): Promise<string | null>;
};
export type ReminderUow = {
  system<T>(tenantId: string, fn: (r: { reminders: ReminderBatchRepo }) => Promise<T>): Promise<T>;
};
export type RemindLog = { warn(msg: string, meta: Record<string, unknown>): void };

export type RemindDeps = {
  finder: DueTenantFinder;
  uow: ReminderUow;
  timeZoneOf: (tenantId: string) => Promise<string>;
  now: () => Date;
  batchSize: number;
  log?: RemindLog;
};
export type RemindBatch = RemindApplied & { tenantId: string; claimed: number };
export type RemindTotals = RemindApplied & { batches: number; claimed: number; failed: number };

/** Review m3: SQLSTATE để log (drizzle bọc lỗi postgres trong `cause`); không log nội dung HĐ. */
const sqlStateOf = (err: unknown): string | null => {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.cause?.code ?? e?.code ?? null;
};

/** Một lô của một tenant trong tx `system(tenant)`; không có việc ⇒ dọn lịch mồ côi. */
async function remindBatch(d: RemindDeps, tenantId: string, now: Date): Promise<RemindBatch> {
  const tz = await d.timeZoneOf(tenantId);
  return d.uow.system(tenantId, async ({ reminders }) => {
    const due = await reminders.claim(now, d.batchSize);
    if (due.length === 0) {
      await reminders.purgeOrphans(now);
      return { tenantId, claimed: 0, statusChanged: 0, reminded: 0, notified: 0 };
    }
    const applied = await reminders.apply(due.map((c) => planReminder(c, now, tz)));
    return { tenantId, claimed: due.length, ...applied };
  });
}

const addBatch = (t: RemindTotals, b: RemindBatch): void => {
  t.batches += b.claimed > 0 ? 1 : 0;
  t.claimed += b.claimed;
  t.statusChanged += b.statusChanged;
  t.reminded += b.reminded;
  t.notified += b.notified;
};

export function createRemindDue(d: RemindDeps) {
  const batch = (tenantId: string, now: Date) => remindBatch(d, tenantId, now);

  /** Một lô (một tenant); không có việc ⇒ null. */
  const once = async (skip: readonly string[] = []): Promise<RemindBatch | null> => {
    const now = d.now();
    const tenantId = await d.finder.next(now, skip);
    return tenantId === null ? null : batch(tenantId, now);
  };

  /** Lặp lô tới hết việc (trần `maxBatches` là lưới an toàn). */
  const drain = async (maxBatches = 100_000): Promise<RemindTotals> => {
    const t: RemindTotals = {
      batches: 0,
      claimed: 0,
      statusChanged: 0,
      reminded: 0,
      notified: 0,
      failed: 0,
    };
    const skip: string[] = [];
    for (let i = 0; i < maxBatches; i++) {
      const now = d.now();
      const tenantId = await d.finder.next(now, skip);
      if (tenantId === null) break;
      try {
        const b = await batch(tenantId, now);
        if (b.claimed === 0) skip.push(tenantId); // hàng đang bị instance khác khoá ⇒ để lượt sau
        addBatch(t, b);
      } catch (err) {
        skip.push(tenantId); // một tenant lỗi không chặn tenant khác (không log nội dung HĐ)
        t.failed++;
        d.log?.warn("contracts-remind-batch-failed", {
          tenantId,
          error: (err as Error)?.name ?? "Error",
          code: sqlStateOf(err),
        });
      }
    }
    return t;
  };
  return { once, drain };
}
