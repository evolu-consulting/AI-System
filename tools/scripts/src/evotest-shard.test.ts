// tool-evotest-cache · unit: chia việc e2e (LPT), chia slot/lõi, gộp thời lượng, tóm tắt gộp.
import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makespan, mergeTimings, planSlots, shardJobs } from "./evotest-shard.rules";

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

describe("planSlots", () => {
  it("-Step all, 7 slot trống, 12 lõi: 1 slot int + 6 slot e2e; mỗi slot ≥ 2 lõi, việc cùng lúc = lõi", () => {
    const p = planSlots({ step: "all", free: 7, cores: 12, jobs: 24 });
    expect(p.intShard).toBe(true);
    expect(p.e2eShards).toBe(6);
    expect(p.intCpus).toBeGreaterThanOrEqual(4);
    expect(p.intWorkers).toBe(p.intCpus);
    expect(p.e2eCpus).toBeGreaterThanOrEqual(2);
    expect(p.e2eJobs).toBe(p.e2eCpus);
  });
  it("-Step e2e dùng mọi slot trống nhưng không quá số việc; ít lõi ⇒ vẫn ≥ 2 lõi/slot", () => {
    expect(planSlots({ step: "e2e", free: 8, cores: 12, jobs: 3 }).e2eShards).toBe(3);
    const p = planSlots({ step: "e2e", free: 4, cores: 4, jobs: 20 });
    expect(p.e2eCpus).toBe(2);
    expect(p.intShard).toBe(false);
  });
  it("một slot trống ⇒ không tách int; ít slot hơn 2 thì -Step all vẫn chạy được (1 ngăn e2e)", () => {
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
