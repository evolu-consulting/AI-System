// TS1 · `bun run test:affected [--base=<ref>] [--e2e=owner|wide|none] [--no-e2e] [--dry-run]`: cổng LÁT — chỉ chạy test dính tới
// diff hiện tại so với `base` (mặc định: merge-base của HEAD với `main`, hoặc HEAD khi đang ở `main` ⇒ chỉ thay đổi chưa commit).
// Đồ thị import (lib/import-graph) → bao đóng ngược của file đổi → unit / int / cấu hình e2e; `check` + `lock` luôn chạy;
// `typecheck` qua `turbo --filter=...[base]`. `test:all` vẫn là cổng ĐỢT (WORKFLOW.md "Cổng lát và cổng đợt").
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Glob } from "bun";
import { isFrozenConfig, isFrozenFile } from "./frozen.rules";
import { repoRoot } from "./lib/git";
import { affectedBy, buildGraph, posix } from "./lib/import-graph";
import { type RunStep, runWaves, summarizeRun } from "./lib/run-steps";
import {
  type AffectedPlan,
  compact,
  configInfos,
  MIGRATION_SEEDS,
  parseAffectedArgs,
  planAffected,
} from "./test-affected.rules";
import { findE2eConfigs } from "./test-all.discover";

function git(root: string, args: string[]): string {
  const p = Bun.spawnSync(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
  return p.exitCode === 0 ? p.stdout.toString().trim() : "";
}

/** `main` còn khác HEAD ⇒ merge-base (diff cả lát đã commit); đang ở `main` hoặc không có `main` ⇒ HEAD (chỉ chưa commit). */
function defaultBase(root: string): string {
  const mb = git(root, ["merge-base", "HEAD", "main"]);
  return mb && mb !== git(root, ["rev-parse", "HEAD"]) ? mb : "HEAD";
}

/** File đổi so với `base` (đã commit + sửa chưa commit) + file chưa theo dõi; đường dẫn `/` tương đối gốc. */
function changedSince(root: string, base: string): string[] {
  const tracked = git(root, ["diff", "--name-only", "--diff-filter=ACMRD", base]).split("\n");
  const fresh = git(root, ["ls-files", "--others", "--exclude-standard"]).split("\n");
  return [...new Set([...tracked, ...fresh].map((f) => posix(f.trim())).filter(Boolean))].sort();
}

/** `pathIgnorePatterns` của một bunfig → bộ khớp (giống cách `bun test` bỏ file). */
function ignorer(root: string, bunfig: string): (f: string) => boolean {
  const toml = readFileSync(join(root, bunfig), "utf8");
  const arr = /pathIgnorePatterns\s*=\s*\[([^\]]*)\]/.exec(toml)?.[1] ?? "";
  const globs = [...arr.matchAll(/"([^"]+)"/g)].map((m) => new Glob(m[1] ?? ""));
  return (f) => globs.some((g) => g.match(f)) || f.includes("node_modules/");
}

function describePlan(base: string, p: AffectedPlan): void {
  const n = (x: string[]) => (x[0] === "*" ? "tất cả" : String(x.length));
  console.log(
    `test:affected: base ${base.slice(0, 12)} · ${p.changed.length} file đổi → ${p.affected} file bị ảnh hưởng`,
  );
  console.log(
    `  unit ${n(p.unit)} · int ${p.int.length} · e2e ${p.e2e.length} (${p.e2e.join(", ") || "—"})`,
  );
  for (const note of p.notes) console.log(`  ! ${note}`);
  if (p.changed.length > 400)
    console.log("  ! diff rất lớn: đặt --base=<commit trước lát> để gom đúng phạm vi lát.");
}

const LIGHT = 1;
const HEAVY = 2;

/** Bước kiểm kiểu + tĩnh (đợt nhẹ): luôn `check` + `lock`; `typecheck` khi có mã apps/packages/tools đổi. */
function lightSteps(p: AffectedPlan, base: string): RunStep[] {
  const steps: RunStep[] = [
    { name: "check", cmd: ["bun", "run", "check"], wave: LIGHT },
    { name: "lock", cmd: ["bun", "run", "test:lock:verify"], wave: LIGHT },
  ];
  if (p.typecheck) {
    const cmd = [
      "bun",
      "x",
      "turbo",
      "run",
      "typecheck",
      `--filter=...[${base}]`,
      "--filter=!@ai/agent-runtime",
    ];
    steps.push({ name: "typecheck", cmd, wave: LIGHT });
  }
  if (p.typecheckTests)
    steps.push({
      name: "typecheck:tests",
      cmd: ["bun", "x", "tsc", "-p", "tsconfig.tests.json"],
      wave: LIGHT,
    });
  if (p.unit.length) {
    const files = p.unit[0] === "*" ? [] : compact(p.unit).map((f) => `./${f}`);
    steps.push({
      name: "unit",
      cmd: ["bun", "--env-file=.env.local", "test", ...files],
      wave: LIGHT,
    });
  }
  return steps;
}

function stepsOf(p: AffectedPlan, base: string, pyBlocked: string | undefined): RunStep[] {
  const steps = lightSteps(p, base);
  if (p.int.length)
    steps.push({
      name: "int",
      cmd: ["bun", "run", "test:int:par", ...compact(p.int)],
      wave: HEAVY,
    });
  if (p.e2e.length) {
    const cmd = ["bun", "tools/scripts/src/test-e2e-par.ts", `--only=${p.e2e.join(",")}`];
    steps.push({ name: "e2e", cmd, wave: HEAVY });
  }
  if (p.python) {
    const cmd = ["bun", "run", "--filter", "@ai/agent-runtime", "test"];
    steps.push(
      pyBlocked
        ? { name: "python", cmd: [], blocked: pyBlocked, wave: HEAVY }
        : { name: "python", cmd, wave: HEAVY },
    );
  }
  return steps;
}

async function main(): Promise<number> {
  const root = repoRoot();
  const args = parseAffectedArgs(process.argv.slice(2));
  const base = args.base ?? defaultBase(root);
  const t0 = performance.now();
  const changed = changedSince(root, base);
  const graph = buildGraph(root);
  const seeds = [
    ...changed,
    ...(changed.some((f) => f.startsWith("packages/db/migrations")) ? MIGRATION_SEEDS : []),
  ];
  const configs = await findE2eConfigs(root);
  const plan = planAffected({
    changed,
    affected: affectedBy(graph, seeds),
    e2eAffected: affectedBy(
      graph,
      changed.filter((f) => f.startsWith("e2e/") || f === "playwright.config.ts"),
    ),
    infos: configInfos(configs, (c) => readFileSync(join(root, c), "utf8")),
    exists: (f) => existsSync(join(root, f)),
    // F1 (CR-095): suite của module đóng băng ra khỏi cổng lát (`bun run test:frozen` chạy theo yêu cầu).
    ignoredUnit: (f) => ignorer(root, "bunfig.toml")(f) || isFrozenFile(f),
    ignoredInt: (f) => ignorer(root, "bunfig.int.toml")(f) || isFrozenFile(f),
    opts: { e2e: args.e2e },
  });
  const skipped = plan.e2e.filter(isFrozenConfig);
  plan.e2e = plan.e2e.filter((c) => !isFrozenConfig(c));
  if (skipped.length)
    plan.notes.push(
      `bỏ ${skipped.length} cấu hình e2e đóng băng (${skipped.join(", ")}); dùng \`bun run test:frozen\`.`,
    );
  describePlan(base, plan);
  console.log(`  (lập kế hoạch ${((performance.now() - t0) / 1000).toFixed(1)} s)`);
  if (args.dryRun) return 0;
  const pyBlocked =
    Bun.which(process.platform === "linux" ? "uv" : "docker") === null
      ? "thiếu docker/uv trên PATH (không tải về)"
      : undefined;
  const results = await runWaves(stepsOf(plan, base, pyBlocked), root, ".data/test-affected");
  return summarizeRun("test:affected", results, performance.now() - t0);
}

process.exit(await main());
