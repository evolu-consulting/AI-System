// CR-092 · `bun run test:all`: chạy lại TOÀN BỘ bộ hồi quy (lint/kiểm lớp, typecheck, unit, int, khoá test, Python,
// mọi cấu hình Playwright tìm thấy trong repo). Cần stack local đang chạy (Postgres, Redis; xem scripts/dev-db.ps1).
// Tuỳ chọn: --no-e2e · --no-python · --serial (nối tiếp từng bước) · --only=<bước|tiền tố>. Không dừng ở bước đỏ đầu tiên.
// TS1: các bước cùng đợt chạy song song; log mỗi bước ở .data/test-all/<bước>.log (in 40 dòng cuối khi đỏ).
import { existsSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "./lib/git";
import { runWaves, summarizeRun } from "./lib/run-steps";
import { buildSteps, parseArgs } from "./test-all.rules";

/** Công cụ có trên PATH và `.env.local`: Python chạy qua `uv` (Linux) hoặc docker (Windows/macOS, scripts/run.ts). */
function detectEnv(root: string): { pyBlocked?: string; envLocal: boolean } {
  const need = process.platform === "linux" ? "uv" : "docker";
  const missing = Bun.which(need) === null;
  return {
    envLocal: existsSync(join(root, ".env.local")),
    ...(missing ? { pyBlocked: `thiếu \`${need}\` trên PATH (không tải về)` } : {}),
  };
}

async function main(): Promise<number> {
  const root = repoRoot();
  const opts = { ...parseArgs(process.argv.slice(2)), ...detectEnv(root) };
  const t0 = performance.now();
  const results = await runWaves(buildSteps(opts), root, ".data/test-all");
  return summarizeRun("test:all", results, performance.now() - t0);
}

process.exit(await main());
