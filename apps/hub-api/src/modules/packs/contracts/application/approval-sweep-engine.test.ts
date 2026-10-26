// contract-flow S3b · vòng quét đồng bộ run engine theo lô: mỗi tenant 1 select + 1 outcomesOf + 1 UPDATE (không phụ thuộc số lượt);
// Từ chối ⇒ reject, run lỗi/huỷ/mất ⇒ release (lý do), run còn chạy ⇒ không đổi; heal extracting → level1 ⇒ mở run.
import { describe, expect, it } from "bun:test";
import type { ReconcileItem, SweepCounts, SweepRepo } from "./approval.ports";
import { sweepApprovalsOnce } from "./approval-sweep";

const T = "00000000-0000-4000-8000-0000000000a1";
const refs = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ approvalId: `a${i}`, runId: `r${i}` }));

function run(o: { n: number; outs: Record<string, object>; healed?: SweepCounts["healedLevel1"] }) {
  const calls: string[] = [];
  let items: readonly ReconcileItem[] = [];
  const repo: SweepRepo = {
    sweep: async () => {
      calls.push("sweep");
      return { read: 0, closed: 0, healed: 0, ...(o.healed ? { healedLevel1: o.healed } : {}) };
    },
    engineRuns: async (limit) => {
      calls.push(`engineRuns:${limit}`);
      return refs(o.n);
    },
    reconcile: async (i) => {
      calls.push("reconcile");
      items = i;
      return {
        rejected: i.filter((x) => x.kind === "reject").length,
        stalled: i.filter((x) => x.kind === "stalled").length,
      };
    },
  };
  const d = {
    uow: {
      system: async <X>(_t: string, fn: (r: { sweep: SweepRepo }) => Promise<X>) =>
        fn({ sweep: repo }),
    },
    tenants: async () => [T],
    engine: {
      port: () => ({
        outcomesOf: async (_t: unknown, ids: readonly string[]) => {
          calls.push(`outcomesOf:${ids.length}`);
          return ids.flatMap((id) =>
            o.outs[id] ? [{ run_id: id, tenant_id: T, stage_key: null, ...o.outs[id] }] : [],
          );
        },
      }),
      start: async (_w: unknown, id: string) => void calls.push(`start:${id}`),
    },
  };
  // biome-ignore lint/suspicious/noExplicitAny: cổng giả
  return { go: () => sweepApprovalsOnce(d as any), calls, items: () => items };
}

describe("sweep · reconcile run engine", () => {
  it("lô 100 lượt: đúng 1 engineRuns + 1 outcomesOf + 1 reconcile; phân loại theo kết cục", async () => {
    const outs: Record<string, object> = {
      r0: { status: "cancelled", rejected: true, feedback: "sai" },
      r1: { status: "failed", rejected: false, feedback: null },
      r2: { status: "waiting_review", rejected: false, feedback: null },
    };
    const x = run({ n: 100, outs }); // r3.. không có trong kết quả ⇒ mất ⇒ release
    const r = await x.go();
    expect(x.calls).toEqual(["sweep", "engineRuns:100", "outcomesOf:100", "reconcile"]);
    expect([r.rejected, r.stalled]).toEqual([1, 98]);
    expect(x.items()[0]).toEqual({
      approvalId: "a0",
      runId: "r0",
      kind: "reject",
      feedback: "sai",
    });
    expect(x.items()[1]).toEqual({
      approvalId: "a1",
      runId: "r1",
      kind: "stalled",
      reason: "ENGINE_RUN_FAILED",
    });
    expect(x.items().some((i) => i.approvalId === "a2")).toBe(false);
  });
  it("không có lượt engine ⇒ không gọi engine; heal level1 ⇒ mở run từng HĐ", async () => {
    const x = run({ n: 0, outs: {}, healed: [{ contractId: "c1", userId: "u1" }] });
    await x.go();
    expect(x.calls).toEqual(["sweep", "engineRuns:100", "start:c1"]);
  });
});
