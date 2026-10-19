// TS1 · chạy các bước theo đợt (dùng chung `test:all` và `test:affected`): bước CÙNG đợt chạy song song, log từng bước ở
// `.data/<thư mục>/<bước>.log` (in 40 dòng cuối khi đỏ); đợt sau chờ đợt trước xong. Không dừng ở bước đỏ đầu tiên.
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type RunStep = { name: string; cmd: string[]; blocked?: string; wave: number };
export type StepResult = { name: string; ok: boolean; ms: number; blocked?: string };

/** Nhóm bước theo đợt (giữ thứ tự), đợt tăng dần. */
export function waves<T extends { wave: number }>(steps: readonly T[]): T[][] {
  const ids = [...new Set(steps.map((s) => s.wave))].sort((a, b) => a - b);
  return ids.map((w) => steps.filter((s) => s.wave === w));
}

function tail(path: string, n: number): string {
  try {
    return readFileSync(path, "utf8").split(/\r?\n/).slice(-n).join("\n");
  } catch {
    return "";
  }
}

async function runOne(step: RunStep, cwd: string, logs: string): Promise<StepResult> {
  if (step.blocked) {
    console.log(`\n⏸ ${step.name}: BỊ CHẶN — ${step.blocked}`);
    return { name: step.name, ok: true, ms: 0, blocked: step.blocked };
  }
  const t0 = performance.now();
  const log = join(cwd, logs, `${step.name.replaceAll(":", "_")}.log`);
  console.log(`▶ ${step.name}: ${step.cmd.join(" ")}  (log ${logs}/…)`);
  const out = Bun.file(log);
  const p = Bun.spawn(step.cmd, { cwd, stdout: out, stderr: out });
  const code = await p.exited;
  const ms = Math.round(performance.now() - t0);
  console.log(`${code === 0 ? "✓" : "✗"} ${step.name} (${(ms / 1000).toFixed(1)} s)`);
  if (code !== 0) console.log(`--- 40 dòng cuối ${step.name} ---\n${tail(log, 40)}\n---`);
  return { name: step.name, ok: code === 0, ms };
}

/** Chạy mọi đợt; trả kết quả theo thứ tự đợt. */
export async function runWaves(
  steps: readonly RunStep[],
  cwd: string,
  logs: string,
): Promise<StepResult[]> {
  mkdirSync(join(cwd, logs), { recursive: true });
  const results: StepResult[] = [];
  for (const wave of waves(steps))
    results.push(...(await Promise.all(wave.map((s) => runOne(s, cwd, logs)))));
  return results;
}

/** In bảng tổng kết + dòng cuối (số bước đỏ/xanh/bị chặn, thời gian tường). Trả mã thoát. */
export function summarizeRun(
  title: string,
  results: readonly StepResult[],
  wallMs: number,
): number {
  console.log(`\n── ${title} ──`);
  for (const r of results)
    console.log(
      r.blocked
        ? `⏸ ${r.name} BỊ CHẶN: ${r.blocked}`
        : `${r.ok ? "✓" : "✗"} ${r.name} (${(r.ms / 1000).toFixed(1)} s)`,
    );
  const failed = results.filter((r) => !r.ok).length;
  const blocked = results.filter((r) => r.blocked).length;
  const ran = results.length - blocked;
  const tailMsg = blocked ? ` · ${blocked} bước BỊ CHẶN (thiếu công cụ, không tính xanh)` : "";
  const wall = `${(wallMs / 1000).toFixed(1)} s`;
  console.log(
    failed ? `${failed}/${ran} bước đỏ${tailMsg}, ${wall}` : `${ran} bước xanh${tailMsg}, ${wall}`,
  );
  return failed ? 1 : 0;
}
