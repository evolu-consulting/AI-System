// CR-092 · `bun run test:all`: chạy lại TOÀN BỘ bộ hồi quy (lint/kiểm lớp, typecheck, unit, int, khoá test, Python,
// mọi cấu hình Playwright tìm thấy trong repo). Cần stack local đang chạy (Postgres, Redis; xem scripts/dev-db.ps1).
// Tuỳ chọn: --no-e2e · --no-python · --only=<bước|tiền tố>. Không dừng ở bước đỏ đầu tiên: chạy hết rồi tổng kết.
import { Glob } from "bun";
import { repoRoot } from "./lib/git";
import { buildSteps, parseArgs, type Step } from "./test-all.rules";

async function findE2eConfigs(root: string): Promise<string[]> {
  const out: string[] = [];
  for await (const f of new Glob("{playwright.config.ts,e2e/**/playwright*.config.ts}").scan(root))
    out.push(f);
  return out;
}

async function run(step: Step, cwd: string): Promise<{ name: string; ok: boolean; ms: number }> {
  const t0 = performance.now();
  console.log(`\n▶ ${step.name}: ${step.cmd.join(" ")}`);
  const p = Bun.spawn(step.cmd, { cwd, stdout: "inherit", stderr: "inherit" });
  const code = await p.exited;
  return { name: step.name, ok: code === 0, ms: Math.round(performance.now() - t0) };
}

async function main(): Promise<number> {
  const root = repoRoot();
  const steps = buildSteps(await findE2eConfigs(root), parseArgs(process.argv.slice(2)));
  const results = [];
  for (const s of steps) results.push(await run(s, root));
  console.log("\n── test:all ──");
  for (const r of results)
    console.log(`${r.ok ? "✓" : "✗"} ${r.name} (${(r.ms / 1000).toFixed(1)} s)`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(failed ? `${failed}/${results.length} bước đỏ` : `${results.length} bước xanh`);
  return failed ? 1 : 0;
}

process.exit(await main());
