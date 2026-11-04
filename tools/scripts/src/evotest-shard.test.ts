// tool-evotest-cache · unit: chia việc e2e (LPT), chia slot/lõi, gộp thời lượng, tóm tắt gộp.
import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  concurrencyBudget,
  makespan,
  mergeTimings,
  planSlots,
  shardJobs,
} from "./evotest-shard.rules";

const J = (o: Record<string, number>) => Object.entries(o).map(([name, cost]) => ({ name, cost }));

describe("shardJobs / makespan", () => {
  const jobs = J({ a: 600, b: 400, c: 300, d: 200, e: 100, f: 50 });
  it("LPT: mọi việc có mặt đúng một lần; ngăn cân bằng", () => {
    const s = shardJobs(jobs, 3);
    expect(s.flat().sort()).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(makespan(jobs, s)).toBeLessThanOrEqual(600); // việc nặng nhất tự đứng một ngăn
    expect(s).toEqual(shardJobs(jobs, 3)); // ổn định
  });
  it("nhiều ngăn hơn số việc ⇒ chỉ ngần ấy ngăn; k=1 ⇒ một ngăn; không việc ⇒ []", () => {
    expect(shardJobs(J({ x: 1, y: 2 }), 8)).toHaveLength(2);
    expect(shardJobs(jobs, 1)).toEqual([["a", "b", "c", "d", "e", "f"]]);
    expect(shardJobs([], 4)).toEqual([]);
  });
  it("makespan không tệ hơn chạy tuần tự và ≥ việc nặng nhất", () => {
    expect(makespan(jobs, shardJobs(jobs, 1))).toBe(1650);
    expect(makespan(jobs, shardJobs(jobs, 2))).toBeGreaterThanOrEqual(825);
  });
});

function combos(): ["all" | "e2e", number, number, number][] {
  const out: ["all" | "e2e", number, number, number][] = [];
  for (const step of ["all", "e2e"] as const)
    for (const free of [1, 2, 4, 8, 12])
      for (const cores of [4, 8, 12, 24, 64])
        for (const jobs of [1, 3, 24]) out.push([step, free, cores, jobs]);
  return out;
}

function assertWithinBudget(p: ReturnType<typeof planSlots>, free: number, jobs: number): void {
  expect(p.total).toBeLessThanOrEqual(Math.max(p.budget, 2));
  expect(p.e2eShards).toBeGreaterThanOrEqual(1);
  expect(p.e2eShards).toBeLessThanOrEqual(Math.max(1, jobs));
  expect(p.e2eShards + (p.intShard ? 1 : 0)).toBeLessThanOrEqual(Math.max(free, 1));
}
describe("planSlots (ngân sách đồng thời = lõi × 1,3)", () => {
  it("ngân sách: 12 lõi ⇒ 16; ít lõi vẫn ≥ 4", () => {
    expect(concurrencyBudget(12)).toBe(16);
    expect(concurrencyBudget(2)).toBe(4);
  });
  it("-Step all, 7 slot trống, 12 lõi: KHÔNG mở hết 6 ngăn e2e - tổng worker/việc ≤ ngân sách (11 ngăn × 8 worker ⇒ load 67 là lỗi)", () => {
    const p = planSlots({ step: "all", free: 7, cores: 12, jobs: 24 });
    expect(p.intShard).toBe(true);
    expect(p.total).toBeLessThanOrEqual(p.budget);
    expect(p.total).toBe(p.intWorkers + p.e2eShards * p.e2eJobs);
    expect(p.e2eShards).toBeLessThanOrEqual(5);
    expect(p.e2eJobs).toBeGreaterThanOrEqual(2);
    expect(p.e2eCpus).toBe(p.e2eJobs);
  });
  it("mọi tổ hợp slot trống/lõi/việc: tổng ≤ ngân sách (trừ sàn 2 việc/ngăn khi ngân sách quá nhỏ)", () => {
    for (const [step, free, cores, jobs] of combos())
      assertWithinBudget(planSlots({ step, free, cores, jobs }), free, jobs);
  });
  it("-Step e2e dùng tối đa số slot trống nhưng không quá số việc; không tách int", () => {
    expect(planSlots({ step: "e2e", free: 8, cores: 12, jobs: 3 }).e2eShards).toBe(3);
    const p = planSlots({ step: "e2e", free: 4, cores: 4, jobs: 20 });
    expect(p.intShard).toBe(false);
    expect(p.e2eJobs).toBeGreaterThanOrEqual(2);
  });
  it("một slot trống ⇒ không tách int; -Step all vẫn chạy được (1 ngăn e2e)", () => {
    const p = planSlots({ step: "all", free: 1, cores: 12, jobs: 10 });
    expect(p.intShard).toBe(false);
    expect(p.e2eShards).toBe(1);
  });
  it("trần: lõi/slot ≤ 8, việc cùng lúc ≤ 9, workers int ≤ 12", () => {
    const p = planSlots({ step: "all", free: 2, cores: 64, jobs: 30 });
    expect(p.e2eCpus).toBeLessThanOrEqual(8);
    expect(p.e2eJobs).toBeLessThanOrEqual(9);
    expect(p.intWorkers).toBeLessThanOrEqual(12);
  });
});
describe("mergeTimings", () => {
  it("lượt mới đè khoá trùng, giữ khoá khác, bỏ số hỏng", () => {
    expect(mergeTimings({ a: 1, b: 2 }, { b: 5, c: 3, d: Number.NaN })).toEqual({
      a: 1,
      b: 5,
      c: 3,
    });
  });
});

describe("merge-timings CLI", () => {
  it("ghi gộp dưới khoá, không để file khoá lại", async () => {
    const d = mkdtempSync(join(tmpdir(), "evo-shard-"));
    writeFileSync(join(d, "dst.json"), JSON.stringify({ a: 1, b: 2 }));
    writeFileSync(join(d, "src.json"), JSON.stringify({ b: 9, c: 3 }));
    const p = Bun.spawn([
      process.execPath,
      join(import.meta.dir, "evotest-shard.ts"),
      "merge-timings",
      join(d, "src.json"),
      join(d, "dst.json"),
    ]);
    expect(await p.exited).toBe(0);
    expect(JSON.parse(readFileSync(join(d, "dst.json"), "utf8"))).toEqual({ a: 1, b: 9, c: 3 });
  });
});
