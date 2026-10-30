// TS1 · `bun run test:e2e:par [--jobs=N] [--shards=N] [--only=<việc|đường dẫn cấu hình>]`: chạy MỌI cấu hình Playwright
// song song có kiểm soát (N việc cùng lúc, mỗi việc DB test + Redis DB + cổng + thư mục dựng riêng; cấu hình gốc `admin`
// chia thành nhiều ca file). Không dừng ở việc đỏ đầu tiên. Log: `.data/e2e/<việc>/*.log`; thời lượng: `.data/e2e-timings.json`.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import { Glob } from "bun";
import { installCleanup, leaseRedisDb, resolveLane } from "./e2e-lane";
import { lanePortEnv, laneTag } from "./e2e-lane.rules";
import { isFrozenConfig } from "./frozen.rules";
import { repoRoot } from "./lib/git";
import { findE2eConfigs } from "./test-all.discover";
import {
  fileSeconds,
  type Job,
  jobConcurrency,
  jobEnv,
  norm,
  parseE2eArgs,
  planJobs,
  type Report,
  type SpecInfo,
  summarize,
} from "./test-e2e-par.rules";
import { parseEnv } from "./test-int-par.rules";

const DIR = ".data/e2e";
const TIMINGS = ".data/e2e-timings.json";

function readJson<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return fallback;
  }
}

/** Spec gốc: ghim ca 0 nếu nhúng cổng 3000; "clock" nếu chờ bước TOTP (dịch đồng hồ máy chủ). */
async function rootSpecs(root: string, timings: Record<string, number>): Promise<SpecInfo[]> {
  const out: SpecInfo[] = [];
  for await (const f of new Glob("e2e/*.spec.ts").scan(root)) {
    const file = norm(f);
    const text = readFileSync(join(root, file), "utf8");
    out.push({
      file,
      cost: timings[file] ?? text.length / 1000,
      pin0: text.includes("localhost:3000"),
      clock: text.includes("waitNextStep"),
    });
  }
  return out;
}

type Done = {
  job: Job;
  code: number;
  ms: number;
  pass: number;
  fail: number;
  flaky: number;
  failed: string[];
};

function failedTitles(rep: Report): string[] {
  const out: string[] = [];
  type S = { title: string; ok?: boolean; specs?: S[]; suites?: S[] };
  const walk = (s: S, path: string[]) => {
    for (const sp of s.specs ?? []) if (sp.ok === false) out.push([...path, sp.title].join(" › "));
    for (const c of s.suites ?? []) walk(c, [...path, c.title]);
  };
  for (const s of (rep.suites ?? []) as S[]) walk(s, [s.title]);
  return out;
}

type Ctx = { root: string; base: Record<string, string>; lane: number; pids: Set<number> };

async function runJob(job: Job, ctx: Ctx, redisDb?: number) {
  const { root, base, lane, pids } = ctx;
  const out = join(DIR, job.name);
  rmSync(join(root, out), { recursive: true, force: true });
  mkdirSync(join(root, out), { recursive: true });
  const json = join(root, out, "report.json");
  const env = {
    ...lanePortEnv(lane, process.env),
    ...jobEnv(
      job,
      base,
      redisDb,
      { dist: `dist-e2e/${job.name}`, clockFile: join(root, out, "clock.txt") },
      lane,
    ),
    E2E_PAR: "1",
  };
  const t0 = performance.now();
  const p = Bun.spawn(
    [
      "bun",
      "tools/scripts/src/run-playwright.ts",
      job.config,
      `--output=${join(out, "pw")}`,
      "--reporter=list,json",
      ...job.files,
    ],
    {
      cwd: root,
      env: { ...process.env, ...env, PLAYWRIGHT_JSON_OUTPUT_NAME: json },
      stdout: Bun.file(join(root, out, "out.log")),
      stderr: Bun.file(join(root, out, "err.log")),
    },
  );
  pids.add(p.pid);
  const code = await p.exited;
  pids.delete(p.pid);
  const rep = readJson<Report>(json, {});
  const s = summarize(rep);
  return { job, code, ms: performance.now() - t0, ...s, failed: failedTitles(rep), rep } as Done & {
    rep: Report;
  };
}

function logDone(r: Done): void {
  const { job, pass, fail, flaky } = r;
  const extra = `${fail ? ` / ${fail} FAIL` : ""}${flaky ? ` / ${flaky} flaky` : ""}`;
  console.log(
    `  ${r.code === 0 ? "✓" : "✗"} ${job.name}: ${pass} pass${extra}, ${(r.ms / 1000).toFixed(1)} s`,
  );
}

/** Hồ N việc chạy cùng lúc, việc nặng trước; việc có Redis nhận một Redis DB rảnh. */
async function pool(jobs: Job[], n: number, ctx: Ctx) {
  const queue = [...jobs];
  const done: (Done & { rep: Report })[] = [];
  const next = async (job: Job) => {
    // Redis DB: hợp đồng thuê toàn máy (mọi worktree) — hết DB thì chờ, không đụng nhau.
    const lease = job.meta.redis ? await leaseRedisDb(`${ctx.root}#${job.name}`) : undefined;
    let r: Awaited<ReturnType<typeof runJob>>;
    try {
      r = await runJob(job, ctx, lease?.db);
    } finally {
      lease?.release();
    }
    done.push(r);
    logDone(r);
  };
  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) await next(job);
  };
  await Promise.all(Array.from({ length: Math.min(n, jobs.length) }, worker));
  return done;
}

function saveTimings(root: string, old: Record<string, number>, done: (Done & { rep: Report })[]) {
  const t = { ...old };
  for (const d of done) {
    // Cấu hình gốc chia ca ⇒ lưu thời lượng từng file spec (dùng để chia ca); cấu hình khác lưu cả cấu hình.
    if (d.job.config !== "playwright.config.ts") t[d.job.config] = Math.round(d.ms / 100) / 10;
    else
      for (const [f, s] of Object.entries(fileSeconds(d.rep)))
        t[`e2e/${f}`] = Math.round(s * 10) / 10;
  }
  writeFileSync(join(root, TIMINGS), `${JSON.stringify(t, null, 2)}\n`);
}

async function ensureDbs(root: string, jobs: Job[], lane: number): Promise<void> {
  const tags = [
    ...new Set(jobs.flatMap((j) => (j.meta.db ? [`e2e_${laneTag(lane, j.meta.db)}`] : []))),
  ];
  if (!tags.length) return;
  const p = Bun.spawn(
    ["bun", "--env-file=.env.local", "packages/db/src/test-db-cli.ts", "ensure", ...tags],
    { cwd: root, stdout: "ignore", stderr: "inherit" },
  );
  if ((await p.exited) !== 0) throw new Error("test-db-cli ensure lỗi");
}

async function main(): Promise<number> {
  const root = repoRoot();
  const args = parseE2eArgs(process.argv.slice(2));
  const timings = readJson<Record<string, number>>(join(root, TIMINGS), {});
  // F1 (CR-095): `--no-frozen` (cổng hằng ngày) bỏ cấu hình e2e của module đóng băng.
  const noFrozen = process.argv.includes("--no-frozen");
  const configs = (await findE2eConfigs(root)).filter((c) => !(noFrozen && isFrozenConfig(c)));
  const specs = await rootSpecs(root, timings);
  const jobs = planJobs({ configs, specs, rootShards: args.shards }, timings, args.only);
  const n = jobConcurrency(args.jobs, availableParallelism());
  const base = parseEnv(readFileSync(join(root, ".env.local"), "utf8"));
  if (!existsSync(join(root, ".env.local"))) throw new Error("thiếu .env.local");
  const lane = resolveLane(root);
  const pids = new Set<number>();
  installCleanup(pids, root, lane);
  const t0 = performance.now();
  console.log(
    `test:e2e:par: làn ${lane}, ${jobs.length} việc / ${n} cùng lúc (${jobs.map((j) => j.name).join(", ")})`,
  );
  await ensureDbs(root, jobs, lane);
  const done = await pool(jobs, n, { root, base, lane, pids });
  saveTimings(root, timings, done);
  const bad = done.filter((d) => d.code !== 0);
  for (const d of bad) for (const f of d.failed) console.log(`  [${d.job.name}] ✗ ${f}`);
  const sum = (k: "pass" | "fail") => done.reduce((a, d) => a + d[k], 0);
  console.log(
    `test:e2e:par: ${sum("pass")} pass, ${sum("fail")} fail, ${((performance.now() - t0) / 1000).toFixed(1)} s` +
      (bad.length
        ? ` — đỏ: ${bad.map((d) => d.job.name).join(", ")} (log ${DIR}/<việc>/out.log)`
        : ""),
  );
  return bad.length ? 1 : 0;
}

process.exit(await main());
