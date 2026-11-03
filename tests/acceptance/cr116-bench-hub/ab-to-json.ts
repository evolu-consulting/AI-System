// CR-116 · bench hub: gom dòng `[ab] …` của nhiều lượt evotest (console.log) thành JSON theo schema baseline của lát probe
// ({commit, date, env, size, runs, probes:{name:{p50,p95,mean,sql,rt,cpu,rss}}}) — một file mỗi kịch bản (ứng viên × cỡ).
// p50/p95/mean = trung vị qua các lượt. Dùng: `bun tests/acceptance/cr116-bench-hub/ab-to-json.ts <outDir> <commit> <log>...`
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const [outDir = ".", commit = "", ...logs] = process.argv.slice(2);
/** Số lượt đo mỗi biến thể (khớp `n` trong file bench) để tính mean = total / n. */
const N: Record<string, number> = { B3: 30, B4: 30, B5: 200, B6w: 20 };
type P = { p50: number[]; p95: number[]; mean: number[]; sql: number; equal: boolean };
const scen = new Map<string, Map<string, P>>();
for (const log of logs) {
  for (const line of readFileSync(log, "utf8").split(/\r?\n/)) {
    const m = line.match(
      /^\[ab\] (\S+) [^|]*\| (.+?) \| rows=(\d+) \| p50=([\d.]+) \| p95=([\d.]+) \| total=([\d.]+) \| sql=(\d+) \| equal=(.)/,
    );
    if (!m) continue;
    const [, cand, variant, rows, p50, p95, total, sql, eq] = m as unknown as string[];
    const key = `${cand}-${rows}`;
    const s = scen.get(key) ?? new Map<string, P>();
    scen.set(key, s);
    const p = s.get(variant as string) ?? {
      p50: [],
      p95: [],
      mean: [],
      sql: Number(sql),
      equal: true,
    };
    p.p50.push(Number(p50));
    p.p95.push(Number(p95));
    p.mean.push(Number(total) / (N[cand as string] ?? 40));
    p.equal &&= eq === "✓";
    s.set(variant as string, p);
  }
}
const med = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return +(s[Math.floor((s.length - 1) / 2)] ?? 0).toFixed(3);
};
mkdirSync(outDir, { recursive: true });
for (const [key, s] of scen) {
  const [cand, size] = key.split("-");
  const probes: Record<string, unknown> = {};
  let runs = 0;
  for (const [v, p] of s) {
    runs = Math.max(runs, p.p50.length);
    probes[v] = {
      p50: med(p.p50),
      p95: med(p.p95),
      mean: med(p.mean),
      sql: p.sql || null, // 0 = client khác pool được tap (Bun.sql / prepare:false) ⇒ không đếm được
      rt: p.sql || null,
      cpu: null,
      rss: null,
      equal: p.equal,
    };
  }
  const doc = {
    commit,
    date: new Date().toISOString(),
    env: "evotest -Step perf -Exclusive (pg 16.15, 4 CPU pg + 4 CPU runner)",
    size: Number(size),
    runs,
    probes,
  };
  writeFileSync(`${outDir}/${cand}-${size}.json`, `${JSON.stringify(doc, null, 2)}\n`);
  console.log(`${cand}-${size}.json · ${Object.keys(probes).length} biến thể · ${runs} lượt`);
}
