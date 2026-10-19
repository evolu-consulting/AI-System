// CR-092 · `bun run test:all`: chạy lại TOÀN BỘ bộ hồi quy (lint/kiểm lớp, typecheck, unit, int, khoá test, Python,
// mọi cấu hình Playwright tìm thấy trong repo). Cần stack local đang chạy (Postgres, Redis; xem scripts/dev-db.ps1).
// Tuỳ chọn: --no-e2e · --no-python · --only=<bước|tiền tố>. Không dừng ở bước đỏ đầu tiên: chạy hết rồi tổng kết.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "./lib/git";
import { findE2eConfigs } from "./test-all.discover";
import { buildSteps, parseArgs, type Step } from "./test-all.rules";

/** Công cụ có trên PATH và `.env.local`: Python chạy qua `uv` (Linux) hoặc docker (Windows/macOS, scripts/run.ts). */
function detectEnv(root: string): { pyBlocked?: string; envLocal: boolean } {
  const need = process.platform === "linux" ? "uv" : "docker";
  const missing = Bun.which(need) === null;
  return {
    envLocal: existsSync(join(root, ".env.local")),
    ...(missing ? { pyBlocked: `thiếu \`${need}\` trên PATH (không tải về)` } : {}),
  };
}

type Result = { name: string; ok: boolean; ms: number; blocked?: string };

async function run(step: Step, cwd: string): Promise<Result> {
  if (step.blocked) {
    console.log(`\n⏸ ${step.name}: BỊ CHẶN — ${step.blocked}`);
    return { name: step.name, ok: true, ms: 0, blocked: step.blocked };
  }
  const t0 = performance.now();
  console.log(`\n▶ ${step.name}: ${step.cmd.join(" ")}`);
  const p = Bun.spawn(step.cmd, { cwd, stdout: "inherit", stderr: "inherit" });
  const code = await p.exited;
  return { name: step.name, ok: code === 0, ms: Math.round(performance.now() - t0) };
}

async function main(): Promise<number> {
  const root = repoRoot();
  const opts = { ...parseArgs(process.argv.slice(2)), ...detectEnv(root) };
  const steps = buildSteps(await findE2eConfigs(root), opts);
  const results = [];
  for (const s of steps) results.push(await run(s, root));
  console.log("\n── test:all ──");
  for (const r of results)
    console.log(
      r.blocked
        ? `⏸ ${r.name} BỊ CHẶN: ${r.blocked}`
        : `${r.ok ? "✓" : "✗"} ${r.name} (${(r.ms / 1000).toFixed(1)} s)`,
    );
  const failed = results.filter((r) => !r.ok).length;
  const blocked = results.filter((r) => r.blocked).length;
  const ran = results.length - blocked;
  const tail = blocked ? ` · ${blocked} bước BỊ CHẶN (thiếu công cụ, không tính xanh)` : "";
  console.log(failed ? `${failed}/${ran} bước đỏ${tail}` : `${ran} bước xanh${tail}`);
  return failed ? 1 : 0;
}

process.exit(await main());
