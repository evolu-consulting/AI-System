// `test:affected --run server`: chạy int + e2e của kế hoạch trên evotest (`deploy/evotest/run-tests.ps1`), chia song song theo số slot
// trống (`res:check --server --json`). Mỗi thùng chạy nối tiếp `-Step int` rồi `-Step e2e`; log ở `.data/test-affected/server-*.log`.
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { StepResult } from "./lib/run-steps";
import type { AffectedPlan } from "./test-affected.rules";
import {
  type Bin,
  evotestArgs,
  freeSlotsOf,
  type ServerCmd,
  serverBins,
} from "./test-affected.server.rules";

function freeSlots(root: string): number | null {
  const p = Bun.spawnSync(["bun", "tools/scripts/src/res-check.ts", "--server", "--json"], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  try {
    return freeSlotsOf(JSON.parse(p.stdout.toString()));
  } catch {
    return null;
  }
}

const dirtyTree = (root: string): boolean =>
  Bun.spawnSync(["git", "status", "--porcelain"], { cwd: root, stdout: "pipe" })
    .stdout.toString()
    .trim() !== "";

/** Dòng đỏ MỚI / đỏ cũ trong log evotest (do test-e2e-par/test-int-par in) — để hiện lại ở tóm tắt cuối. */
function redLines(log: string): string[] {
  return log
    .split(/\r?\n/)
    .filter((l) => /đỏ MỚI|^\s*NEW \[|^\s*NEW \d+/.test(l) || /đỏ cũ/.test(l))
    .slice(0, 60);
}

type Flags = { dirty: boolean; all: boolean };

async function runCmd(root: string, bin: number, cmd: ServerCmd, fl: Flags): Promise<StepResult> {
  const name = `server:${bin}:${cmd.step}`;
  const log = join(root, ".data/test-affected", `server-${bin}-${cmd.step}.log`);
  const shell = Bun.which("pwsh") ? "pwsh" : "powershell";
  const t0 = performance.now();
  console.log(
    `▶ ${name}: evotest -Step ${cmd.step} -Filter "${cmd.filter.slice(0, 120)}"  (log ${log})`,
  );
  const p = Bun.spawn([shell, ...evotestArgs(cmd, fl.dirty, fl.all)], {
    cwd: root,
    stdout: Bun.file(log),
    stderr: Bun.file(log),
  });
  const code = await p.exited;
  let text = "";
  try {
    text = readFileSync(log, "utf8");
  } catch {}
  for (const l of redLines(text)) console.log(`  [${name}] ${l}`);
  const ms = Math.round(performance.now() - t0);
  console.log(`${code === 0 ? "✓" : "✗"} ${name} (mã ${code}, ${(ms / 1000).toFixed(1)} s)`);
  return { name, ok: code === 0, ms };
}

async function runBin(root: string, i: number, bin: Bin, fl: Flags): Promise<StepResult[]> {
  const out: StepResult[] = [];
  for (const cmd of bin.cmds) out.push(await runCmd(root, i, cmd, fl));
  return out;
}

/** Chạy int + e2e của kế hoạch trên evotest; các thùng song song. Mã evotest: 0 xanh, 1 đỏ mới, 2 dựng lỗi, 3 chờ slot, 4 đĩa. */
export async function runServer(
  root: string,
  plan: AffectedPlan,
  configs: readonly string[],
  opts: { frozen: boolean; e2eJobs?: readonly string[]; dirty?: boolean } = { frozen: false },
): Promise<StepResult[]> {
  const jobs = [...new Set([...plan.jobs, ...(opts.e2eJobs ?? [])])];
  if (!plan.int.length && !jobs.length) {
    console.log("test:affected: không có int/e2e để chạy trên máy chủ.");
    return [];
  }
  mkdirSync(join(root, ".data/test-affected"), { recursive: true });
  const free = freeSlots(root);
  const bins = serverBins(plan.int, jobs, configs, free ?? 1);
  console.log(
    `test:affected: máy chủ ${free === null ? "không đo được slot (dùng 1)" : `${free} slot trống`} → ${bins.length} thùng song song`,
  );
  const fl: Flags = { dirty: opts.dirty || dirtyTree(root), all: opts.frozen };
  const done = await Promise.all(bins.map((b, i) => runBin(root, i + 1, b, fl)));
  return done.flat();
}
