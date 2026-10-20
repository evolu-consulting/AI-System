// L1 (TECH-DEBT #224) · semaphore trần phép băm: trần đồng thời, FIFO, hàng đợi đầy từ chối ngay, lỗi vẫn trả slot.
import { describe, expect, test } from "bun:test";
import { Semaphore, SemaphoreFullError } from "./semaphore";

/** Việc giữ slot tới khi test gọi `open()` — chờ bằng promise, không hẹn giờ. */
function gate() {
  let open!: () => void;
  const p = new Promise<void>((r) => {
    open = r;
  });
  return { p, open };
}

describe("L1 · Semaphore", () => {
  test("không quá `max` việc chạy cùng lúc; người chờ chạy theo thứ tự FIFO", async () => {
    const s = new Semaphore(2, 10);
    const order: number[] = [];
    const gates = [gate(), gate(), gate(), gate()];
    const runs = gates.map((g, i) =>
      s.run(async () => {
        order.push(i);
        await g.p;
        return i;
      }),
    );
    await Promise.resolve();
    expect(s.stats).toEqual({ active: 2, queued: 2 });
    expect(order).toEqual([0, 1]);
    gates[1]?.open();
    await runs[1];
    await Promise.resolve();
    expect(order).toEqual([0, 1, 2]);
    for (const g of gates) g.open();
    expect(await Promise.all(runs)).toEqual([0, 1, 2, 3]);
    expect(s.stats).toEqual({ active: 0, queued: 0 });
  });

  test("hàng đợi đầy ⇒ SemaphoreFullError ngay, không chạy fn", async () => {
    const s = new Semaphore(1, 1);
    const g = gate();
    const a = s.run(() => g.p);
    const b = s.run(() => g.p);
    let ran = false;
    await expect(
      s.run(async () => {
        ran = true;
      }),
    ).rejects.toBeInstanceOf(SemaphoreFullError);
    expect(ran).toBe(false);
    g.open();
    await Promise.all([a, b]);
  });
});

describe("L1 · Semaphore · lỗi", () => {
  test("fn ném lỗi vẫn trả slot", async () => {
    const s = new Semaphore(1, 0);
    await expect(s.run(() => Promise.reject(new Error("x")))).rejects.toThrow("x");
    expect(await s.run(async () => 7)).toBe(7);
    expect(s.stats).toEqual({ active: 0, queued: 0 });
  });

  test("tham số sai ⇒ ném khi tạo", () => {
    expect(() => new Semaphore(0, 1)).toThrow();
    expect(() => new Semaphore(1, -1)).toThrow();
  });
});
