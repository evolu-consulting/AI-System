// P-d1 · HUB-FR-143 · `bun run done:pd1`: Lệnh xong mốc P-d1 (tasks.md T12).
// Chạy tuần tự, KHÔNG dừng ở bước đỏ; cuối in tổng kết. `--list` chỉ in các bước. int/e2e dùng DB test: không chạy song song bộ khác.
// Playwright cần Node: nếu `node` không có trên PATH, đặt thư mục Node (env `PLAYWRIGHT_NODE_DIR`, mặc định node-22 trong tools) đầu PATH, chỉ cho bước e2e.

import { existsSync, realpathSync } from "node:fs";
import { delimiter } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isRealNode,
  type PdResult,
  type PdStep,
  parseDepcruise,
  pd1Steps,
  prependPath,
  resolveNodeDir,
  summarize,
} from "./done-pd1.rules";

export const REPO = fileURLToPath(new URL("../../..", import.meta.url));

export function stepEnv(step: PdStep): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env };
  if (!step.nodeDir) return env;
  const key = Object.keys(env).find((k) => k.toLowerCase() === "path") ?? "PATH";
  env[key] = prependPath(step.nodeDir, env[key], delimiter);
  return env;
}

function runDepcruise(step: PdStep, t0: number): PdResult {
  const p = Bun.spawnSync(step.argv, {
    cwd: REPO,
    env: stepEnv(step),
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = p.stdout.toString() + p.stderr.toString();
  console.log(out.trim());
  const { total, ca } = parseDepcruise(out);
  console.log(`depcruise: tổng ${total} vi phạm, ca-*: ${ca}`);
  // Không đọc được kết quả (mã ≠ 0 mà không có dòng vi phạm) vẫn coi là đỏ.
  const unreadable = p.exitCode !== 0 && total === 0;
  return { title: step.title, code: ca === 0 && !unreadable ? 0 : 1, ms: performance.now() - t0 };
}

export function run(step: PdStep): PdResult {
  console.log(`\n▶ ${step.title}`);
  const t0 = performance.now();
  if (step.kind === "depcruise") return runDepcruise(step, t0);
  const p = Bun.spawnSync(step.argv, {
    cwd: REPO,
    env: stepEnv(step),
    stdout: "inherit",
    stderr: "inherit",
  });
  return { title: step.title, code: p.exitCode ?? 1, ms: performance.now() - t0 };
}

export function detectRealNode(): boolean {
  const p = Bun.which("node");
  if (!p) return false;
  let resolved = p;
  try {
    resolved = realpathSync(p);
  } catch {}
  return isRealNode(p, resolved);
}

export function buildSteps(env: Record<string, string | undefined> = process.env): PdStep[] {
  const nodeDir = resolveNodeDir({
    override: env.PLAYWRIGHT_NODE_DIR,
    nodeOnPath: detectRealNode(),
    exists: existsSync,
  });
  return pd1Steps({ bun: process.execPath, platform: process.platform, nodeDir });
}

export function main(argv: string[]): number {
  const steps = buildSteps();
  if (argv.includes("--list")) {
    for (const [i, s] of steps.entries())
      console.log(
        `${i + 1}. ${s.title}${s.nodeDir ? ` [PATH+=${s.nodeDir}]` : ""}\n   ${s.argv.join(" ")}`,
      );
    return 0;
  }
  const { text, ok } = summarize(steps.map(run));
  console.log(`\n${text}`);
  return ok ? 0 : 1;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
