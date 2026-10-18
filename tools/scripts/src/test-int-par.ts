// ADM-NFR-06 · `bun run test:int:par [--workers=N] [tiền tố…]`: test int song song. Mỗi worker một tiến trình `bun test`
// với DB riêng (`ai_system_w<i>_test`, `ai_system_w<i>_h1_test`) và Redis DB `10+i`; file trong `INT_SERIAL` chạy tuần tự
// sau cùng trên DB/Redis của worker 0. Log mỗi worker: `.data/int-w<i>.log`; thời lượng file: `.data/int-timings.json`.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import { Glob } from "bun";
import { repoRoot } from "./lib/git";
import {
  parseEnv,
  parseIntArgs,
  parseJunit,
  partition,
  selectFiles,
  type Timings,
  workerEnv,
  workerTags,
} from "./test-int-par.rules";

const DATA = ".data";
const TIMINGS = join(DATA, "int-timings.json");
const BASE_CMD = [
  "bun",
  "--env-file=.env.local",
  "--config=bunfig.int.toml",
  "test",
  "--timeout",
  "30000",
];

/** Mẫu bỏ qua của `bunfig.int.toml` (`pathIgnorePatterns`), để danh sách file giống `bun run test:int`. */
function ignoreGlobs(root: string): Glob[] {
  const toml = readFileSync(join(root, "bunfig.int.toml"), "utf8");
  const arr = /pathIgnorePatterns\s*=\s*\[([^\]]*)\]/.exec(toml)?.[1] ?? "";
  return [...arr.matchAll(/"([^"]+)"/g)].map((m) => new Glob(m[1] ?? ""));
}

async function findIntFiles(root: string): Promise<string[]> {
  const ignore = ignoreGlobs(root);
  const out: string[] = [];
  for await (const f of new Glob("**/*.int.test.{ts,tsx}").scan(root)) {
    const p = f.replaceAll("\\", "/");
    if (!p.includes("node_modules/") && !ignore.some((g) => g.match(p))) out.push(p);
  }
  return out;
}

const dbName = (tag: string) => `ai_system_${tag}_test`;
/** Worker không tự gom rác DB (xem `cloneMigratedTestDb`); runner xoá một lần ở cuối. */
const NO_GC = { TEST_DB_GC: "0" };

type Run = { name: string; files: number; code: number; ms: number; log: string; junit: string };

async function runShard(name: string, files: string[], env: Record<string, string>, root: string) {
  const log = join(DATA, `int-${name}.log`);
  const junit = join(DATA, `int-junit-${name}.xml`);
  const t0 = performance.now();
  const p = Bun.spawn(
    [...BASE_CMD, "--reporter=junit", `--reporter-outfile=${junit}`, ...files.map((f) => `./${f}`)],
    { cwd: root, env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" },
  );
  const [out, err] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
  ]);
  writeFileSync(join(root, log), out + err);
  const code = await p.exited;
  const r: Run = { name, files: files.length, code, ms: performance.now() - t0, log, junit };
  console.log(
    `  ${code === 0 ? "✓" : "✗"} ${name}: ${files.length} file, ${(r.ms / 1000).toFixed(1)} s`,
  );
  return r;
}

/** Dòng tổng kết + các ca `(fail)` trong log của một lần chạy. */
function summarize(root: string, r: Run): { pass: number; fail: number; fails: string[] } {
  const text = readFileSync(join(root, r.log), "utf8");
  const num = (re: RegExp) => Number(re.exec(text)?.[1] ?? 0);
  const fails = text.split(/\r?\n/).filter((l) => l.startsWith("(fail)"));
  return { pass: num(/^\s*(\d+) pass/m), fail: num(/^\s*(\d+) fail/m), fails };
}

function loadTimings(root: string): Timings {
  try {
    return JSON.parse(readFileSync(join(root, TIMINGS), "utf8")) as Timings;
  } catch {
    return {};
  }
}

function saveTimings(root: string, runs: Run[], old: Timings): void {
  const t = { ...old };
  for (const r of runs)
    if (existsSync(join(root, r.junit)))
      Object.assign(t, parseJunit(readFileSync(join(root, r.junit), "utf8")));
  writeFileSync(join(root, TIMINGS), `${JSON.stringify(t, null, 2)}\n`);
}

async function dbCli(root: string, args: string[]): Promise<void> {
  const p = Bun.spawn(["bun", "--env-file=.env.local", "packages/db/src/test-db-cli.ts", ...args], {
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
  });
  if ((await p.exited) !== 0) throw new Error(`test-db-cli ${args[0]} lỗi`);
}

const ensureDbs = (root: string, n: number) =>
  dbCli(root, [
    "ensure",
    ...Array.from({ length: n }, (_, i) => Object.values(workerTags(i))).flat(),
  ]);

async function main(): Promise<number> {
  const root = repoRoot();
  mkdirSync(join(root, DATA), { recursive: true });
  const opts = parseIntArgs(process.argv.slice(2), availableParallelism());
  const { parallel, serial } = selectFiles(await findIntFiles(root), opts.filters);
  const timings = loadTimings(root);
  const n = Math.max(1, Math.min(opts.workers, parallel.length));
  const shards = partition(parallel, timings, n);
  console.log(`test:int:par: ${parallel.length} file / ${n} worker, ${serial.length} file tuần tự`);
  const t0 = performance.now();
  await ensureDbs(root, n);
  const env = { ...parseEnv(readFileSync(join(root, ".env.local"), "utf8")), ...process.env };
  const runs = await Promise.all(
    shards.map((files, i) =>
      runShard(`w${i}`, files, { ...workerEnv(env, i, dbName), ...NO_GC }, root),
    ),
  );
  // Tuần tự sau cùng, trên DB/Redis của worker 0 (đã rảnh): không đụng DB chung của phiên khác đang chạy test:int.
  if (serial.length)
    runs.push(await runShard("serial", serial, { ...workerEnv(env, 0, dbName), ...NO_GC }, root));
  // DB rác (đích cũ sau mỗi lần dựng lại) xoá một lần, song song: DROP DATABASE ép checkpoint, không làm giữa chừng.
  await dbCli(root, ["gc"]).catch((e) => console.error(String(e)));
  saveTimings(root, runs, timings);
  let [pass, fail] = [0, 0];
  for (const r of runs) {
    const s = summarize(root, r);
    pass += s.pass;
    fail += s.fail;
    for (const l of s.fails) console.log(`  [${r.name}] ${l}`);
  }
  const bad = runs.filter((r) => r.code !== 0);
  console.log(
    `test:int:par: ${pass} pass, ${fail} fail, ${((performance.now() - t0) / 1000).toFixed(1)} s` +
      (bad.length ? ` — đỏ: ${bad.map((r) => `${r.name} (${r.log})`).join(", ")}` : ""),
  );
  return bad.length ? 1 : 0;
}

process.exit(await main());
