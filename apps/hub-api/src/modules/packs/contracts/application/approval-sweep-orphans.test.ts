// CR-107 · dọn run engine mồ côi (sập giữa `start` và `attach`): 1 câu engine (run mở của gói trước `now - 10'`) + 1 câu gói (run
// đang gắn) ⇒ chỉ huỷ run chưa gắn; đồng hồ giả quyết mốc; cổng thiếu hàm ⇒ bỏ bước.
import { describe, expect, it } from "bun:test";
import type { SweepRepo } from "./approval.ports";
import { cancelOrphans, ORPHAN_MINUTES, type SweepDeps } from "./approval-sweep";

const T = "00000000-0000-4000-8000-0000000000a1";
const NOW = new Date("2026-11-02T10:00:00Z");

function deps(open: string[], attached: string[]) {
  const calls: string[] = [];
  const repo = {
    attachedRuns: async (ids: readonly string[]) => {
      calls.push(`attached:${ids.length}`);
      return attached;
    },
  } as unknown as SweepRepo;
  const d: SweepDeps = {
    uow: { system: async (_t, fn) => fn({ sweep: repo }) },
    tenants: async () => [T],
    now: () => NOW,
    engine: {
      port: () => ({
        outcomesOf: async () => [],
        openPackRuns: async (_t, pack, before, limit) => {
          calls.push(`open:${pack}:${before.toISOString()}:${limit}`);
          return open.map((id) => ({ run_id: id, record_id: id }));
        },
        cancelSys: async (_t, id) => {
          calls.push(`cancel:${id}`);
          return id !== "gone";
        },
      }),
      start: async () => undefined,
    },
  };
  return { d, calls };
}

describe("CR-107 · cancelOrphans", () => {
  it("run mở trước now-10' chưa gắn lượt ⇒ huỷ · run đã gắn ⇒ giữ · 1 câu engine + 1 câu gói", async () => {
    const { d, calls } = deps(["r1", "r2", "r3"], ["r2"]);
    expect(await cancelOrphans(d, T)).toBe(2);
    const before = new Date(NOW.getTime() - ORPHAN_MINUTES * 60_000).toISOString();
    expect(calls).toEqual([`open:contracts:${before}:100`, "attached:3", "cancel:r1", "cancel:r3"]);
  });
  it("không có run mở ⇒ 0 câu gói · huỷ trả false (đã kết thúc) ⇒ không đếm", async () => {
    const a = deps([], []);
    expect(await cancelOrphans(a.d, T)).toBe(0);
    expect(a.calls.length).toBe(1);
    const b = deps(["gone"], []);
    expect(await cancelOrphans(b.d, T)).toBe(0);
  });
});
