// ADM-NFR-06 · `bun run test:int:par [--workers=N] [tiền tố…]`: test int song song. Mỗi worker một tiến trình `bun test`
// trên một "ô" thuê riêng (DB `ai_system_s<ô>_test`, `ai_system_s<ô>_h1_test`, Redis DB <ô>; hai lượt cùng lúc không chung
// ô). Worker lấy lô từ hàng đợi chung (file nặng trước); `INT_SERIAL` chạy tuần tự sau cùng trên ô đầu.
// Log: `.data/int-s<ô>.log`; thời lượng file (JUnit): `.data/int-timings.json`.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import { Glob } from "bun";
import { isFrozenFile } from "./frozen.rules";
import { repoRoot } from "./lib/git";
import {
  lptQueue,
  parseEnv,
  parseIntArgs,
  parseJunit,
  selectFiles,
  type Timings,
  takeChunk,
  workerCount,
  workerEnv,
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

type Run = { name: string; files: number; code: number; ms: number; text: string; junit: string };

/** Một lô file trong một tiến trình `bun test`; log nối vào `.data/int-<ô>.log`. */
async function runChunk(
  slot: string,
  k: number,
  files: string[],
  opts: { env: Record<string, string>; root: string },
) {
  const { env, root } = opts;
  const name = `${slot}-${k}`;
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
  const text = out + err;
  appendFileSync(join(root, DATA, `int-${slot}.log`), `\n=== ${name}: ${files.join(" ")}\n${text}`);
  const code = await p.exited;
  return { name, files: files.length, code, ms: performance.now() - t0, text, junit } satisfies Run;
}

/** Worker ở ô `slot`: lấy lô từ hàng đợi chung tới khi hết (không chia tĩnh ⇒ không worker nào gánh đuôi). */
async function worker(
  slot: string,
  queue: string[],
  ctx: { timings: Timings; n: number; env: Record<string, string> },
  root: string,
) {
  writeFileSync(join(root, DATA, `int-${slot}.log`), "");
  const runs: Run[] = [];
  const t0 = performance.now();
  for (let k = 0; queue.length; k++) {
    const files = ctx.n === 1 ? queue.splice(0) : takeChunk(queue, ctx.timings, ctx.n);
    runs.push(await runChunk(slot, k, files, { env: ctx.env, root }));
  }
  const nf = runs.reduce((a, r) => a + r.files, 0);
  const ok = runs.every((r) => r.code === 0);
  console.log(
    `  ${ok ? "✓" : "✗"} ${slot}: ${nf} file / ${runs.length} lô, ${((performance.now() - t0) / 1000).toFixed(1)} s`,
  );
  return runs;
}

/** Dòng tổng kết + các ca `(fail)` trong log của một lô. */
function summarize(r: Run): { pass: number; fail: number; fails: string[] } {
  const num = (re: RegExp) => Number(re.exec(r.text)?.[1] ?? 0);
  const lines = r.text.split(/\r?\n/);
  const fails = lines.filter((l) => l.startsWith("(fail)"));
  // Lỗi không gắn ca nào ("# Unhandled error between tests", chunk đỏ dù 0 fail): liệt kê để không bị che.
  const k = lines.findIndex((l) => l.startsWith("# Unhandled error"));
  const errs = num(/^\s*(\d+) error/m);
  if (errs > 0)
    fails.push(
      `(unhandled) ${k >= 0 ? (lines.slice(k + 1, k + 4).find((l) => l.startsWith("error:")) ?? "") : ""}`,
    );
  return { pass: num(/^\s*(\d+) pass/m), fail: num(/^\s*(\d+) fail/m) + errs, fails };
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

/** `test-db-cli gc 32` tách rời tiến trình cha (không chờ): chỉ xoá DB `…_trash_<id>_test` (mỗi lượt tên riêng). */
function gcInBackground(root: string): void {
  const p = Bun.spawn(
    ["bun", "--env-file=.env.local", "packages/db/src/test-db-cli.ts", "gc", "32"],
    {
      cwd: root,
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    },
  );
  p.unref();
}

/** Thuê ô worker (advisory lock giữ trong tiến trình con tới khi lượt này xong/chết; tạo DB của ô). */
async function leaseSlots(
  root: string,
  n: number,
): Promise<{ slots: number[]; release: () => void }> {
  const p = Bun.spawn(
    ["bun", "--env-file=.env.local", "packages/db/src/test-db-cli.ts", "lease", String(n)],
    { cwd: root, stdin: "pipe", stdout: "pipe", stderr: "inherit" },
  );
  const reader = p.stdout.getReader();
  let text = "";
  while (!/LEASE [\d,]+\r?\n/.test(text)) {
    const { value, done } = await reader.read();
    if (done) throw new Error("test-db-cli lease lỗi");
    text += new TextDecoder().decode(value);
  }
  const slots = (/LEASE ([\d,]+)/.exec(text)?.[1] ?? "").split(",").map(Number);
  return { slots, release: () => p.stdin.end() };
}

/**
 * File nặng DB (INT_SERIAL) chạy NỐI TIẾP trên ô đầu sau khi pool xong. TS1 đã thử chạy song song mỗi file một ô: ca "hash lệch →
 * dựng lại" của test-db-template quá 60 s vì tranh DB mẫu/ALTER ROLE với 3 file kia ⇒ hoàn lại nối tiếp (đo ≈ 40–85 s).
 */
async function serialLanes(
  serial: string[],
  slots: string[],
  envOf: (i: number) => Record<string, string>,
  root: string,
): Promise<Run[]> {
  if (!serial.length) return [];
  return [await runChunk(`${slots[0]}-serial`, 0, serial, { env: envOf(0), root })];
}

async function main(): Promise<number> {
  const root = repoRoot();
  mkdirSync(join(root, DATA), { recursive: true });
  const opts = parseIntArgs(process.argv.slice(2), availableParallelism());
  // F1 (CR-095): `--no-frozen` (cổng hằng ngày) bỏ file int của module đóng băng.
  const noFrozen = process.argv.includes("--no-frozen");
  const all = (await findIntFiles(root)).filter((f) => !(noFrozen && isFrozenFile(f)));
  const { parallel, serial } = selectFiles(all, opts.filters);
  const timings = loadTimings(root);
  const t0 = performance.now();
  const lease = await leaseSlots(
    root,
    workerCount(opts.workers, parallel.length + serial.length, 99),
  );
  const n = workerCount(opts.workers, parallel.length, lease.slots.length);
  const slots = lease.slots.slice(0, n).map((s) => `s${s}`);
  console.log(
    `test:int:par: ${parallel.length} file / ${n} worker (${slots.join(",")}), ${serial.length} file tuần tự`,
  );
  const env = { ...parseEnv(readFileSync(join(root, ".env.local"), "utf8")), ...process.env };
  const envOf = (i: number) => ({ ...workerEnv(env, lease.slots[i] ?? 1, dbName), ...NO_GC });
  const queue = lptQueue(parallel, timings);
  const runs = (
    await Promise.all(slots.map((s, i) => worker(s, queue, { timings, n, env: envOf(i) }, root)))
  ).flat();
  runs.push(...(await serialLanes(serial, slots, envOf, root)));
  lease.release();
  // DB rác (đích cũ khi test đổi schema) xoá theo loạt khi đủ 32 cái: mỗi DROP DATABASE ép checkpoint (đo ~1 s/DB trên máy
  // này ⇒ 30–35 s cho 35–58 DB). TS1: chạy NỀN tách rời (không chặn kết quả); lượt sau không thấy khác biệt vì tên rác duy nhất.
  gcInBackground(root);
  saveTimings(root, runs, timings);
  let [pass, fail] = [0, 0];
  for (const r of runs) {
    const s = summarize(r);
    pass += s.pass;
    fail += s.fail;
    for (const l of s.fails) console.log(`  [${r.name}] ${l}`);
  }
  const bad = runs.filter((r) => r.code !== 0);
  console.log(
    `test:int:par: ${pass} pass, ${fail} fail, ${((performance.now() - t0) / 1000).toFixed(1)} s` +
      (bad.length ? ` — đỏ: ${bad.map((r) => r.name).join(", ")} (log .data/int-s*.log)` : ""),
  );
  return bad.length ? 1 : 0;
}

process.exit(await main());
