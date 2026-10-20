// TD #242 · semaphore job trích chạy trong tiến trình (Redis sập / vắng Redis): tối đa K chạy cùng lúc, còn lại xếp hàng FIFO.
import { describe, expect, it } from "bun:test";
import type { ExtractJob } from "../application/approval.usecase";
import { withFallback } from "../extraction.mount";
import { createInprocLimiter } from "./inproc-limit";

const gate = () => {
  let open: () => void = () => undefined;
  const p = new Promise<void>((r) => {
    open = r;
  });
  return { p, open };
};

describe("TD #242 · createInprocLimiter", () => {
  it("không quá max đồng thời; phần dư xếp hàng và chạy theo thứ tự khi có chỗ", async () => {
    const lim = createInprocLimiter(2);
    const gates = Array.from({ length: 5 }, gate);
    const started: number[] = [];
    let peak = 0;
    const runs = gates.map((g, i) =>
      lim.run(async () => {
        started.push(i);
        peak = Math.max(peak, lim.running);
        await g.p;
      }),
    );
    await Promise.resolve();
    expect(started).toEqual([0, 1]);
    expect([lim.running, lim.waiting]).toEqual([2, 3]);
    gates[0]?.open();
    await runs[0];
    await Promise.resolve();
    expect(started).toEqual([0, 1, 2]);
    for (const g of gates) g.open();
    await Promise.all(runs);
    expect(started).toEqual([0, 1, 2, 3, 4]);
    expect(peak).toBe(2);
    expect([lim.running, lim.waiting]).toEqual([0, 0]);
  });

  it("job ném lỗi không kẹt chỗ và không ném ra ngoài (gọi onError)", async () => {
    const errs: unknown[] = [];
    const lim = createInprocLimiter(1, (e) => void errs.push(e));
    await lim.run(async () => {
      throw new Error("x");
    });
    let ran = false;
    await lim.run(async () => {
      ran = true;
    });
    expect(errs).toHaveLength(1);
    expect(ran).toBe(true);
    expect(lim.running).toBe(0);
  });
});

describe("TD #242 · withFallback qua semaphore", () => {
  const job = (n: number): ExtractJob => ({ contractId: `c${n}` }) as unknown as ExtractJob;

  it("XADD lỗi (Redis down): N job chạy trong tiến trình nhưng chỉ K cùng lúc; log mỗi lần", async () => {
    const warns: string[] = [];
    const lim = createInprocLimiter(2);
    const q = withFallback(
      {
        enqueue: async () => {
          throw new Error("redis down");
        },
      },
      async (j) => {
        started.push(j.contractId);
        peak = Math.max(peak, lim.running);
        await gates.get(j.contractId)?.p;
      },
      { warn: (m) => void warns.push(m) },
      lim,
    );
    const started: string[] = [];
    let peak = 0;
    const gates = new Map<string, ReturnType<typeof gate>>(
      Array.from({ length: 6 }, (_, i) => [`c${i}`, gate()]),
    );
    for (let i = 0; i < 6; i++) await q.enqueue(job(i));
    await Promise.resolve();
    expect(started).toEqual(["c0", "c1"]);
    expect(lim.waiting).toBe(4);
    expect(warns).toHaveLength(6);
    for (const g of gates.values()) g.open();
    while (lim.running + lim.waiting > 0) await Promise.resolve();
    expect(started).toHaveLength(6);
    expect(peak).toBe(2);
  });

  it("enqueue thành công ⇒ không chạy trong tiến trình", async () => {
    const lim = createInprocLimiter(1);
    let ran = 0;
    const q = withFallback(
      { enqueue: async () => undefined },
      async () => void ran++,
      undefined,
      lim,
    );
    await q.enqueue(job(1));
    expect([ran, lim.running]).toEqual([0, 0]);
  });
});
