// F1 (CR-095) · `bun run test:frozen [--no-e2e]`: chạy suite của module ĐÓNG BĂNG (docs/platform/modules.md) theo yêu cầu — khi nâng cấp
// Bun/Postgres/Dify hoặc khi lát sửa mã module đóng băng. Cổng hằng ngày (`test:affected`, `test:all --no-frozen`) bỏ chúng.
// Unit (`bun test`), int (`test:int:par`, DB riêng mỗi worker) và các cấu hình e2e đóng băng; cần stack local như `test:all`.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Glob } from "bun";
import { FROZEN_E2E_CONFIGS, isFrozenFile } from "./frozen.rules";
import { repoRoot } from "./lib/git";
import { type RunStep, runWaves, summarizeRun } from "./lib/run-steps";
import { compact } from "./test-affected.rules";
import { jobSlug } from "./test-e2e-par.rules";

/** `pathIgnorePatterns` của bunfig (giống cách `bun test` bỏ file). */
function ignorer(root: string, bunfig: string): (f: string) => boolean {
  const toml = readFileSync(join(root, bunfig), "utf8");
  const arr = /pathIgnorePatterns\s*=\s*\[([^\]]*)\]/.exec(toml)?.[1] ?? "";
  const globs = [...arr.matchAll(/"([^"]+)"/g)].map((m) => new Glob(m[1] ?? ""));
  return (f) => globs.some((g) => g.match(f)) || f.includes("node_modules/");
}

async function frozenTests(root: string): Promise<{ unit: string[]; int: string[] }> {
  const skipUnit = ignorer(root, "bunfig.toml");
  const skipInt = ignorer(root, "bunfig.int.toml");
  const unit: string[] = [];
  const int: string[] = [];
  for await (const f of new Glob("**/*.test.{ts,tsx}").scan(root)) {
    const p = f.replaceAll("\\", "/");
    if (!isFrozenFile(p)) continue;
    if (/\.int\.test\.tsx?$/.test(p)) {
      if (!skipInt(p) && !/\.perf\.int\.test\.tsx?$/.test(p)) int.push(p);
    } else if (!skipUnit(p)) unit.push(p);
  }
  return { unit: unit.sort(), int: int.sort() };
}

async function main(): Promise<number> {
  const root = repoRoot();
  const t0 = performance.now();
  const { unit, int } = await frozenTests(root);
  const steps: RunStep[] = [];
  if (unit.length)
    steps.push({
      name: "unit",
      cmd: ["bun", "--env-file=.env.local", "test", ...compact(unit).map((f) => `./${f}`)],
      wave: 1,
    });
  if (int.length)
    steps.push({ name: "int", cmd: ["bun", "run", "test:int:par", ...compact(int)], wave: 2 });
  if (!process.argv.includes("--no-e2e") && FROZEN_E2E_CONFIGS.length) {
    const only = FROZEN_E2E_CONFIGS.map(jobSlug).join(",");
    steps.push({
      name: "e2e",
      cmd: ["bun", "tools/scripts/src/test-e2e-par.ts", `--only=${only}`],
      wave: 3,
    });
  }
  console.log(
    `test:frozen: ${unit.length} unit · ${int.length} int · ${FROZEN_E2E_CONFIGS.length} cấu hình e2e`,
  );
  const results = await runWaves(steps, root, ".data/test-frozen");
  return summarizeRun("test:frozen", results, performance.now() - t0);
}

process.exit(await main());
