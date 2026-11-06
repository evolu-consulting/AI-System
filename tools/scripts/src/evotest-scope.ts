// `bun tools/scripts/src/evotest-scope.ts --step S [--filter F] [--all] [--wave] [--repo DIR]` — gọi từ run-tests.ps1 TRƯỚC khi upload.
// In "phạm vi: N file int / M job e2e (K spec)"; lát chạy quá rộng ⇒ in lý do + exit 6 (xem evotest-scope.rules.ts).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Glob } from "bun";
import { decideScope, isSliceWorktree, scopeLine, splitFilter } from "./evotest-scope.rules";

const argv = process.argv.slice(2);
const val = (k: string) => {
  const i = argv.indexOf(k);
  return i >= 0 ? (argv[i + 1] ?? "") : "";
};
const step = val("--step");
const filter = val("--filter");
const all = argv.includes("--all");
const repo = val("--repo") || process.cwd();

function run(args: string[]): { code: number; out: string } {
  const p = Bun.spawnSync(["bun", ...args], { cwd: repo, stdout: "pipe", stderr: "pipe" });
  return { code: p.exitCode ?? 1, out: p.stdout.toString() };
}

/** Số file spec của một cấu hình Playwright: đọc `testDir` + `testMatch` (chuỗi) trong file cấu hình; mặc định `**\/*.spec.ts`. */
function countSpecs(config: string): number {
  const file = join(repo, config);
  const text = readFileSync(file, "utf8");
  const dir = join(dirname(file), /testDir:\s*["']([^"']+)["']/.exec(text)?.[1] ?? ".");
  const match = /testMatch:\s*["']([^"']+)["']/.exec(text)?.[1] ?? "**/*.spec.ts";
  let n = 0;
  for (const f of new Glob(match).scanSync({ cwd: dir })) if (!f.includes("node_modules")) n++;
  return n;
}

function countJobs(only: string, frozen: string[]): { jobs: number; specs: number } {
  const r = run([
    "tools/scripts/src/test-e2e-par.ts",
    "--list",
    ...frozen,
    ...(only ? [`--only=${only}`] : []),
  ]);
  try {
    const jobs = JSON.parse(r.out) as { config: string; nfiles: number }[];
    const specs = jobs.reduce((a, j) => a + (j.nfiles || countSpecs(j.config)), 0);
    return { jobs: jobs.length, specs };
  } catch {
    console.log("evotest: không đếm được job e2e (bỏ qua chốt phạm vi phần e2e)");
    return { jobs: 0, specs: 0 };
  }
}

function main(): number {
  if (!["int", "e2e", "all"].includes(step)) return 0; // unit/perf/py: không thuộc chốt
  const branch = Bun.spawnSync(["git", "rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: repo,
    stdout: "pipe",
  })
    .stdout.toString()
    .trim();
  const f = splitFilter(step, filter);
  const frozen = all ? [] : ["--no-frozen"];
  // `-Step all` + filter chỉ nêu một phía ⇒ phía kia không chạy (không đếm cả bộ)
  const narrow = step === "all" && filter.trim() !== "";
  let intFiles = 0;
  if (step !== "e2e" && !(narrow && !f.int.length)) {
    const r = run(["tools/scripts/src/test-int-par.ts", "--check-only", ...f.int, ...frozen]);
    intFiles = Number(/(\d+) file int/.exec(r.out)?.[1] ?? 0);
  }
  const e2e =
    step !== "int" && !(narrow && !f.e2e.length)
      ? countJobs(f.e2e.join(","), frozen)
      : { jobs: 0, specs: 0 };
  const { jobs: e2eJobs, specs: e2eSpecs } = e2e;
  console.log(`evotest: ${scopeLine({ intFiles, e2eJobs, e2eSpecs })}`);
  const wave = argv.includes("--wave") || process.env.EVOTEST_WAVE === "1";
  const v = decideScope({
    slice: isSliceWorktree(repo, branch),
    wave,
    hasFilter: filter.trim() !== "",
    intFiles,
    e2eJobs,
    e2eSpecs,
  });
  if (v.allow) return 0;
  console.log(`evotest: DỪNG trước khi upload - ${v.reason}`);
  return 6;
}

process.exit(main());
