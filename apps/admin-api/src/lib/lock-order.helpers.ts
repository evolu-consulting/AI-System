// ADM-NFR-07, ADM-FR-53 · công cụ cho test khoá hàng xen kẽ TẤT ĐỊNH (plan M2 §6, plan M3 §6.3) — chỉ test dùng.
// Hook `afterLock` dừng tx A đúng một lần ở (op, step); test chờ B thật sự đợi khoá (pg_stat_activity) rồi mới mở A.
// Deadlock thật chỉ bị Postgres phát hiện sau deadlock_timeout rồi withScope chạy lại → kiểm cả bộ đếm deadlock lẫn thời gian.
import type postgres from "postgres";
import type { HookOp, HookStep, TestHooks } from "./test-hooks";

export type Barrier = { hooks: TestHooks; locked: Promise<void>; open: () => void };
export type Settled = { ok: boolean; v?: unknown; e?: unknown };
type Run = () => Promise<unknown>;

/** Hook dừng đúng một lần ở `target` + `step`; test mở bằng tay. */
export function barrier(target: HookOp, step: HookStep = "locked"): Barrier {
  let open: () => void = () => undefined;
  let reached: () => void = () => undefined;
  const opened = new Promise<void>((r) => {
    open = r;
  });
  const locked = new Promise<void>((r) => {
    reached = r;
  });
  let used = false;
  const hooks: TestHooks = {
    afterLock: async (op, s) => {
      if (op !== target || s !== step || used) return;
      used = true;
      reached();
      await opened;
    },
  };
  return { hooks, locked, open: () => open() };
}

export const settle = (p: Promise<unknown>): Promise<Settled> =>
  p.then(
    (v) => ({ ok: true, v }),
    (e) => ({ ok: false, e }),
  );

export const codeOf = (r: Settled) => (r.e as { code?: string } | undefined)?.code;

/** Bộ đếm deadlock của DB + chờ có backend đợi khoá. */
function statsKit(owner: postgres.Sql) {
  const deadlocks = async (): Promise<number> => {
    await owner`select pg_stat_force_next_flush(), pg_stat_clear_snapshot()`;
    const [r] = await owner`select deadlocks::int as n from pg_stat_database
      where datname = current_database()`;
    return Number(r?.n ?? 0);
  };
  /** Số deadlock tăng thêm; backend đẩy thống kê khi rảnh (≤ ~1 s) nên poll tới hạn chót, tăng là trả ngay. */
  const deadlocksSince = async (before: number, deadlineMs = 1500): Promise<number> => {
    const end = Date.now() + deadlineMs;
    for (;;) {
      const n = (await deadlocks()) - before;
      if (n > 0 || Date.now() >= end) return n;
      await Bun.sleep(50);
    }
  };
  /** Chờ tới khi có ít nhất một backend đang đợi khoá (wait_event_type = 'Lock'). */
  const waitForLockWait = async (): Promise<void> => {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const [r] = await owner`select count(*)::int as n from pg_stat_activity
        where datname = current_database() and wait_event_type = 'Lock'`;
      if ((r?.n ?? 0) >= 1) return;
      await Bun.sleep(20);
    }
    throw new Error("không thấy request thứ hai chờ khoá");
  };
  return { deadlocks, deadlocksSince, waitForLockWait };
}

export function lockKit(owner: postgres.Sql) {
  const st = statsKit(owner);
  /** A dừng ở barrier → B chạy và PHẢI chờ khoá → mở A. */
  const interleave = async (first: Run, second: Run, b: Barrier) => {
    const before = await st.deadlocks();
    const pa = settle(first());
    await b.locked;
    const pb = settle(second());
    await st.waitForLockWait();
    const t0 = performance.now();
    b.open();
    const [ra, rb] = await Promise.all([pa, pb]);
    return { ra, rb, ms: performance.now() - t0, deadlocks: await st.deadlocksSince(before) };
  };
  /** A dừng ở barrier → B chạy XONG trong lúc A dừng (không được chờ A) → mở A. */
  const passBy = async (first: Run, second: Run, b: Barrier) => {
    const before = await st.deadlocks();
    const pa = settle(first());
    await b.locked;
    const blocked = (): Settled => ({ ok: false, e: new Error("B bị chặn bởi A") });
    const rb = await Promise.race([settle(second()), Bun.sleep(1500).then(blocked)]);
    b.open();
    const ra = await pa;
    return { ra, rb, deadlocks: await st.deadlocksSince(before) };
  };
  return { ...st, interleave, passBy };
}
