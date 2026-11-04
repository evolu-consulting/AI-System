// tool-evotest-cache · CLI nhỏ cho `deploy/evotest/run-tests.ps1` (chia lượt toàn bộ) và in-container.sh (thời lượng việc e2e dùng chung).
//   plan --jobs <file.json [{name,cost}]> --free N --cores C --step all|e2e   → JSON kế hoạch (SlotPlan + shards: [{jobs:"a,b"}] + ước tính)
//   merge-timings <src.json> <dst.json>   gộp (đè) src vào dst dưới khoá thư mục (nhiều slot cùng ghi /cache/e2e-timings.json)
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { withDirLock } from "./evotest-cache.lib";
import { makespan, mergeTimings, planSlots, shardJobs } from "./evotest-shard.rules";

const arg = (k: string): string | undefined => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const readJson = <T>(f: string, fallback: T): T => {
  try {
    return JSON.parse(readFileSync(f, "utf8")) as T;
  } catch {
    return fallback;
  }
};

function plan(): void {
  const jobs = readJson<{ name: string; cost: number }[]>(arg("jobs") ?? "", []);
  const step = arg("step") === "e2e" ? "e2e" : "all";
  const p = planSlots({
    step,
    free: Number(arg("free") ?? 1),
    cores: Number(arg("cores") ?? 12),
    jobs: jobs.length,
  });
  const shards = shardJobs(jobs, p.e2eShards);
  console.log(
    JSON.stringify({
      ...p,
      shards: shards.map((s) => ({ jobs: s.join(",") })),
      estimateS: Math.round(makespan(jobs, shards)),
    }),
  );
}

async function merge(): Promise<void> {
  const [src, dst, seed] = [process.argv[3], process.argv[4], process.argv[5]];
  if (!src || !dst) throw new Error("dùng: merge-timings <src.json> <dst.json> [seed.json]");
  if (!existsSync(src)) return;
  // seed = bản đã chép từ dst lúc đầu lượt: chỉ gộp khoá lượt này ĐỔI (không đè số mới của slot khác bằng số cũ từ seed)
  const prev = seed ? readJson<Record<string, number>>(seed, {}) : {};
  const mine = Object.fromEntries(
    Object.entries(readJson<Record<string, number>>(src, {})).filter(([k, v]) => prev[k] !== v),
  );
  await withDirLock(`${dst}.lock`, async () => {
    const merged = mergeTimings(readJson(dst, {}), mine);
    writeFileSync(`${dst}.tmp`, `${JSON.stringify(merged, null, 2)}\n`);
    renameSync(`${dst}.tmp`, dst);
  });
}

if (import.meta.main) {
  const cmd = process.argv[2];
  if (cmd === "plan") plan();
  else if (cmd === "merge-timings") await merge();
  else {
    console.error(
      "dùng: evotest-shard.ts plan --jobs f --free N --cores C --step all|e2e | merge-timings <src> <dst>",
    );
    process.exit(2);
  }
}
