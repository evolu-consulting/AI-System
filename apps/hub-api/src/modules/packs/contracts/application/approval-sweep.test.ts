// Review HD3 m2/m3/m4: vòng quét — con trỏ xoay vòng (tenant > `limit` HĐ trong flow vẫn tới lượt), song song có trần,
// run `failed` ⇒ hành động `failed` (không "Bị từ chối"). Uow + cổng giả (không DB).
import { describe, expect, test } from "bun:test";
import type { PackRunOutcomeSys } from "../../kit/application/pack-runs.ports";
import type { FlowCursor, FlowRow } from "./approval.ports";
import { type SweepCursors, sweepApprovalsOnce } from "./approval-sweep";

const row = (n: number, runId: string | null): FlowRow => ({
  id: `c${n}`,
  runId,
  status: "needs_review",
  stale: false,
  updatedAt: `2026-10-19T00:00:0${n}.000Z`,
});

function harness(rows: FlowRow[], outs: PackRunOutcomeSys[]) {
  const afters: (FlowCursor | null)[] = [];
  const closed: unknown[] = [];
  let live = 0;
  let peak = 0;
  const sweep = {
    inFlow: async (_s: number, limit: number, after: FlowCursor | null) => {
      afters.push(after);
      live++;
      peak = Math.max(peak, live);
      await Promise.resolve();
      live--;
      const from = after ? rows.findIndex((r) => r.id === after.id) + 1 : 0;
      return rows.slice(from, from + limit);
    },
    close: async (c: readonly unknown[]) => {
      closed.push(...c);
      return c.length;
    },
  };
  const d = {
    uow: {
      system: (_t: string, fn: (r: { sweep: typeof sweep }) => unknown) => fn({ sweep }),
    } as never,
    bridge: { port: { outcomesOf: async () => outs } as never },
    tenants: async () => ["t"],
    limit: 2,
  };
  return { d, afters, closed, peak: () => peak };
}

describe("sweepApprovalsOnce", () => {
  test("m2 · con trỏ: lượt 1 đọc 2 đầu, lượt 2 đọc tiếp, hết ⇒ quay đầu", async () => {
    const h = harness([row(1, "r1"), row(2, "r2"), row(3, "r3")], []);
    const cur: SweepCursors = new Map();
    await sweepApprovalsOnce(h.d, cur);
    await sweepApprovalsOnce(h.d, cur);
    await sweepApprovalsOnce(h.d, cur);
    expect(h.afters.map((a) => a?.id ?? null)).toEqual([null, "c2", null]);
  });
  test("m4 · run failed ⇒ action failed; cancelled + reject ⇒ rejected", async () => {
    const outs = [
      { run_id: "r1", tenant_id: "t", status: "failed", rejected: false, feedback: null },
      { run_id: "r2", tenant_id: "t", status: "cancelled", rejected: true, feedback: "Sai" },
    ];
    const h = harness([row(1, "r1"), row(2, "r2")], outs);
    await sweepApprovalsOnce({ ...h.d, limit: 10 });
    expect(h.closed).toEqual([
      { id: "c1", runId: "r1", action: "failed", feedback: null },
      { id: "c2", runId: "r2", action: "rejected", feedback: "Sai" },
    ]);
  });
  test("m3 · nhiều tenant ⇒ tối đa 4 lượt đọc song song", async () => {
    const h = harness([row(1, null)], []);
    const tenants = Array.from({ length: 10 }, (_, i) => `t${i}`);
    await sweepApprovalsOnce({ ...h.d, tenants: async () => tenants });
    expect(h.peak()).toBeLessThanOrEqual(4);
    expect(h.afters).toHaveLength(10);
  });
});
