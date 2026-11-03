// CR-116 · khung kịch bản đo (probe): tuỳ chọn từ env `PERF_PROBE_OPTS` ("runs=3,size=small"), phát dòng meta + start/end mỗi
// lượt (runner `bun run perf:probe` gom theo các dòng này). Chỉ chạy khi `PERF_PROBE=1` (evotest `-Probe`); ngoài ra các file
// kịch bản bị bỏ qua (`describe.skipIf(!probing)`) nên không ảnh hưởng `test:perf`/`test:int`.
import { probeEmit, probeOn } from "@ai/db/probe";
import type { Sql } from "postgres";

export const probing = probeOn();
export type Size = "small" | "large";

// biome-ignore lint/suspicious/noUndeclaredEnvVars: env do runner evotest đặt (`run-tests.ps1 -Probe`)
const OPTS = process.env.PERF_PROBE_OPTS ?? "";

export function scnOpts(raw = OPTS): { runs: number; size: Size } {
  const kv = new Map(
    raw
      .split(/[,\s]+/)
      .filter((s) => s.includes("="))
      .map((s) => s.split("=", 2) as [string, string]),
  );
  const runs = Number(kv.get("runs") ?? 3);
  return {
    runs: Number.isInteger(runs) && runs > 0 ? runs : 3,
    size: kv.get("size") === "large" ? "large" : "small",
  };
}

/** Chạy `body` `runs` lần; mỗi lượt phát `scenario.start`/`scenario.end` (ms, cpu, rss đỉnh KiB, số kết nối PG). */
export async function runScenario(
  scn: string,
  sql: Sql,
  body: (r: number, size: Size) => Promise<void>,
): Promise<void> {
  const { runs, size } = scnOpts();
  const [v] = await sql<{ v: string }[]>`select current_setting('server_version') as v`;
  probeEmit("meta", { scn, pg: v?.v, size, runs, cpus: navigator.hardwareConcurrency });
  for (let r = 1; r <= runs; r++) {
    probeEmit("scenario.start", { scn, r });
    const t0 = performance.now();
    const c0 = process.cpuUsage();
    await body(r, size);
    const c = process.cpuUsage(c0);
    const [n] = await sql<{ n: number }[]>`select count(*)::int as n from pg_stat_activity
      where datname = current_database()`;
    probeEmit("scenario.end", {
      scn,
      r,
      ms: Math.round(performance.now() - t0),
      cpu: Math.round((c.user + c.system) / 1000),
      rss: process.resourceUsage().maxRSS,
      conns: n?.n,
    });
  }
}
