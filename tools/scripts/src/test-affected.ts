// TS1 · `bun run test:affected [--base <ref>] [--json] [--run local|server|all] [--e2e=owner|wide|none] [--no-e2e] [--frozen]
// [--no-quarantine]`: cổng LÁT — chỉ test dính tới diff `base...HEAD` + chưa commit (mặc định base: merge-base HEAD với
// `platform/gd0`, rồi `main`; không có ⇒ HEAD). Đồ thị import (lib/import-graph) → bao đóng ngược → unit / int / cấu hình + việc e2e /
// gói typecheck. Không `--run` ⇒ CHỈ in kế hoạch (người + `--json`). `--run local` = check+lock+typecheck+unit tại máy; `--run server` =
// int + e2e trên evotest chia theo slot trống; `--run all` = mọi thứ tại máy (dùng bởi `slice:merge`). Quarantine đỏ đã biết
// (tests/known-red.json) mặc định bật ở các lệnh int/e2e. `test:all` vẫn là cổng ĐỢT (WORKFLOW.md "Cổng lát và cổng đợt").
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Glob } from "bun";
import { loadExternalOwned } from "./external-owned";
import { externalMatcher } from "./external-owned.rules";
import { isFrozenConfig, isFrozenFile } from "./frozen.rules";
import { repoRoot } from "./lib/git";
import { affectedBy, buildGraph, posix } from "./lib/import-graph";
import { type RunStep, runWaves, type StepResult, summarizeRun } from "./lib/run-steps";
import {
  type AffectedArgs,
  type AffectedPlan,
  compact,
  configInfos,
  jobOfConfig,
  parseAffectedArgs,
  planAffected,
  planToJson,
} from "./test-affected.rules";
import { affectedScoped, buildScope } from "./test-affected.scope";
import { runServer } from "./test-affected.server";
import { findE2eConfigs } from "./test-all.discover";

function git(root: string, args: string[]): string {
  const p = Bun.spawnSync(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
  return p.exitCode === 0 ? p.stdout.toString().trim() : "";
}

/** merge-base của HEAD với `platform/gd0` (rồi `main`) khi còn khác HEAD (diff cả lát đã commit); không có ⇒ HEAD (chỉ chưa commit). */
function defaultBase(root: string): string {
  const head = git(root, ["rev-parse", "HEAD"]);
  for (const ref of ["platform/gd0", "main"]) {
    const mb = git(root, ["merge-base", "HEAD", ref]);
    if (mb && mb !== head) return mb;
  }
  return "HEAD";
}

/** `git diff <base>...HEAD` (đã commit) + sửa chưa commit + file chưa theo dõi; đường dẫn `/` tương đối gốc. */
function changedSince(root: string, base: string): string[] {
  const names = (...a: string[]) => git(root, ["diff", "--name-only", "--diff-filter=ACMRD", ...a]);
  const committed = names(`${base}...HEAD`).split("\n");
  const dirty = names("HEAD").split("\n");
  const fresh = git(root, ["ls-files", "--others", "--exclude-standard"]).split("\n");
  return [
    ...new Set([...committed, ...dirty, ...fresh].map((f) => posix(f.trim())).filter(Boolean)),
  ].sort();
}

/** `pathIgnorePatterns` của một bunfig → bộ khớp (giống cách `bun test` bỏ file). */
function ignorer(root: string, bunfig: string): (f: string) => boolean {
  const toml = readFileSync(join(root, bunfig), "utf8");
  const arr = /pathIgnorePatterns\s*=\s*\[([^\]]*)\]/.exec(toml)?.[1] ?? "";
  const globs = [...arr.matchAll(/"([^"]+)"/g)].map((m) => new Glob(m[1] ?? ""));
  return (f) => globs.some((g) => g.match(f)) || f.includes("node_modules/");
}

/** Nội dung file ở `base` (undefined = chưa có ở base). */
function gitShow(root: string, base: string, f: string): string | undefined {
  const p = Bun.spawnSync(["git", "show", `${base}:${f}`], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  return p.exitCode === 0 ? p.stdout.toString() : undefined;
}

function explainLines(p: AffectedPlan): void {
  for (const e of p.expansions) console.log(`  ⇱ mở rộng: ${e}`);
  if (p.ignored.length)
    console.log(`  ∅ bỏ qua (không ảnh hưởng test runtime): ${p.ignored.join(", ")}`);
  for (const f of [...p.int, ...p.e2e]) console.log(`  · ${f} ← ${p.reasons[f] ?? "?"}`);
}

function describePlan(base: string, p: AffectedPlan, explain: boolean): void {
  const n = (x: string[]) => (x[0] === "*" ? "tất cả" : String(x.length));
  console.log(
    `test:affected: base ${base.slice(0, 12)} · ${p.changed.length} file đổi → ${p.affected} file bị ảnh hưởng`,
  );
  console.log(
    `  unit ${n(p.unit)} · int ${p.int.length} · e2e ${p.e2e.length} (${p.e2e.join(", ") || "—"})`,
  );
  console.log(`  việc e2e: ${p.jobs.join(", ") || "—"}`);
  console.log(
    `  typecheck: ${p.typecheck ? `${p.typecheckPackages.length} gói (${p.typecheckPackages.join(", ")})` : "không"}${p.typecheckTests ? " + tests/e2e (tsconfig.tests)" : ""}`,
  );
  for (const note of p.notes) console.log(`  ! ${note}`);
  if (explain) explainLines(p);
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

/** `all` (mọi thứ tại máy, như `test:affected` cũ / `slice:merge`): thêm int + e2e + python; `quarantine` ⇒ mã thoát chỉ tính đỏ mới. */
function stepsOf(
  p: AffectedPlan,
  base: string,
  pyBlocked: string | undefined,
  quarantine: boolean,
): RunStep[] {
  const steps = lightSteps(p, base);
  const q = quarantine ? ["--quarantine"] : [];
  if (p.int.length)
    steps.push({
      name: "int",
      cmd: ["bun", "run", "test:int:par", ...q, ...compact(p.int)],
      wave: HEAVY,
    });
  if (p.e2e.length) {
    const cmd = ["bun", "tools/scripts/src/test-e2e-par.ts", ...q, `--only=${p.e2e.join(",")}`];
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
  const t1 = performance.now();
  const scope = buildScope(
    {
      changed,
      strict: args.strict,
      graph,
      readFile: (f) =>
        existsSync(join(root, f)) ? readFileSync(join(root, f), "utf8") : undefined,
      readBase: (f) => gitShow(root, base, f),
    },
    [...graph.deps.keys()],
  );
  const { affected, why } = affectedScoped(graph, scope, changed);
  const t2 = performance.now();
  const configs = await findE2eConfigs(root);
  // Test của người khác sở hữu (tests/external-owned.json, vd DLC của rowan): bỏ, đếm số file bị bỏ; `--include-external` giữ.
  const isExternal = args.includeExternal ? () => false : externalMatcher(loadExternalOwned(root));
  const extSeen = new Set<string>();
  const external = (f: string): boolean => {
    const hit = isExternal(f);
    if (hit && !f.endsWith("config.ts")) extSeen.add(f);
    return hit;
  };
  const plan = planAffected({
    changed,
    affected,
    scope,
    why,
    e2eAffected: affectedBy(
      graph,
      changed.filter((f) => f.startsWith("e2e/") || f === "playwright.config.ts"),
    ),
    infos: configInfos(configs, (c) => readFileSync(join(root, c), "utf8")),
    exists: (f) => existsSync(join(root, f)),
    // F1 (CR-095): suite của module đóng băng ra khỏi cổng lát (`bun run test:frozen` chạy theo yêu cầu; hoặc `--frozen`).
    ignoredUnit: (f) =>
      ignorer(root, "bunfig.toml")(f) || (!args.frozen && isFrozenFile(f)) || external(f),
    ignoredInt: (f) =>
      ignorer(root, "bunfig.int.toml")(f) || (!args.frozen && isFrozenFile(f)) || external(f),
    opts: { e2e: args.e2e },
  });
  const skipped = args.frozen ? [] : plan.e2e.filter(isFrozenConfig);
  const skippedExt = plan.e2e.filter(external);
  plan.e2e = plan.e2e.filter((c) => !skipped.includes(c) && !skippedExt.includes(c));
  plan.externalSkipped = extSeen.size + skippedExt.length;
  if (plan.externalSkipped)
    plan.notes.push(`bỏ ${plan.externalSkipped} test của rowan (--include-external để chạy).`);
  plan.jobs = plan.jobs.filter((j) => plan.e2e.some((c) => jobOfConfig(c) === j));
  if (skipped.length)
    plan.notes.push(
      `bỏ ${skipped.length} cấu hình e2e đóng băng (${skipped.join(", ")}); dùng \`bun run test:frozen\` hoặc --frozen.`,
    );
  if (args.json) console.log(JSON.stringify(planToJson(base, plan, args.explain), null, 2));
  else {
    describePlan(base, plan, args.explain);
    const sec = (a: number, b: number) => ((b - a) / 1000).toFixed(1);
    const now = performance.now();
    console.log(
      `  (lập kế hoạch ${sec(t0, now)} s: đồ thị ${sec(t0, t1)} · phân loại+bao đóng ${sec(t1, t2)} · còn lại ${sec(t2, now)})`,
    );
  }
  if (args.run === "none") return 0;
  return runPlan(root, args, { base, plan, configs: configs.map(posix), t0 });
}

type Planned = { base: string; plan: AffectedPlan; configs: string[]; t0: number };

async function runPlan(root: string, args: AffectedArgs, x: Planned): Promise<number> {
  const { base, plan, configs, t0 } = x;
  const pyBlocked =
    Bun.which(process.platform === "linux" ? "uv" : "docker") === null
      ? "thiếu docker/uv trên PATH (không tải về)"
      : undefined;
  const logs = ".data/test-affected";
  const results: StepResult[] = [];
  if (args.run === "all")
    results.push(...(await runWaves(stepsOf(plan, base, pyBlocked, args.quarantine), root, logs)));
  else {
    if (args.run === "local") results.push(...(await runWaves(lightSteps(plan, base), root, logs)));
    if (args.run === "server") results.push(...(await runServer(root, plan, configs, args)));
  }
  return summarizeRun("test:affected", results, performance.now() - t0);
}

process.exit(await main());
