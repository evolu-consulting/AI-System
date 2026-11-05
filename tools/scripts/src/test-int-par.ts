// ADM-NFR-06 · `bun run test:int:par [--workers=N] [tiền tố…]`: test int song song. Mỗi worker một tiến trình `bun test`
// trên một "ô" thuê riêng (DB `ai_system_s<ô>_test`, `ai_system_s<ô>_h1_test`, Redis DB <ô>; hai lượt cùng lúc không chung
// ô). Worker lấy lô từ hàng đợi chung (file nặng trước); `INT_SERIAL` chạy tuần tự sau cùng trên ô đầu.
// Watchdog (tool-evotest-hang): `--hang-idle=<s>` (im, mặc định 120) / `--hang-file=<s>` (một file, mặc định 300), env INT_HANG_IDLE_S/_FILE_S; 0 = tắt.
// Log: `.data/int-s<ô>.log`; thời lượng file (JUnit): `.data/int-timings.json`.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import { Glob } from "bun";
import { isFrozenFile } from "./frozen.rules";
import { reportReds } from "./known-red";
import { intReds, quarantineOn } from "./known-red.rules";
import { repoRoot } from "./lib/git";
import {
  lptQueue,
  parseEnv,
  parseIntArgs,
  parseJunit,
  resolveIntFiles,
  selectFiles,
  type Timings,
  takeChunk,
  workerCount,
  workerEnv,
} from "./test-int-par.rules";
import { DATA, drain, type Run } from "./test-int-par.run";
import { type HangCfg, hangLine, parseHangCfg } from "./test-int-par.watchdog";

const TIMINGS = join(DATA, "int-timings.json");
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

/** Worker ở ô `slot`: lấy lô từ hàng đợi chung tới khi hết (không chia tĩnh ⇒ không worker nào gánh đuôi). */
async function worker(
  slot: string,
  queue: string[],
  ctx: { timings: Timings; n: number; env: Record<string, string>; hang: HangCfg },
  root: string,
) {
  writeFileSync(join(root, DATA, `int-${slot}.log`), "");
  const t0 = performance.now();
  const take = (q: string[]) => (ctx.n === 1 ? q.splice(0) : takeChunk(q, ctx.timings, ctx.n));
  const runs = await drain(slot, queue, take, { env: ctx.env, root, hang: ctx.hang });
  const nf = runs.reduce((a, r) => a + r.files - (r.hung?.rest.length ?? 0), 0);
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
  // Lô bị watchdog kill (không có dòng tổng kết): file treo luôn là một đỏ MỚI có tên.
  const hang = r.hung ? 1 : 0;
  if (r.hung) fails.push(`(treo) ${hangLine(r.hung)}`);
  if (errs > 0)
    fails.push(
      `(unhandled) ${k >= 0 ? (lines.slice(k + 1, k + 4).find((l) => l.startsWith("error:")) ?? "") : ""}`,
    );
  return { pass: num(/^\s*(\d+) pass/m), fail: num(/^\s*(\d+) fail/m) + errs + hang, fails };
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

/** 10 file int chậm nhất của lượt này (từ JUnit) - để biết file nào kéo dài cả lượt. */
function printSlowest(root: string, runs: Run[]): void {
  const cur: Timings = {};
  for (const r of runs)
    if (existsSync(join(root, r.junit)))
      Object.assign(cur, parseJunit(readFileSync(join(root, r.junit), "utf8")));
  const top = Object.entries(cur)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  if (top.length)
    console.log(
      `test:int:par: 10 file chậm nhất:\n${top.map(([f, s]) => `  ${s.toFixed(1)} s  ${f}`).join("\n")}`,
    );
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
  hang: HangCfg,
): Promise<Run[]> {
  if (!serial.length) return [];
  return drain(`${slots[0]}-serial`, [...serial], (q) => q.splice(0), {
    env: envOf(0),
    root,
    hang,
  });
}

async function main(): Promise<number> {
  const root = repoRoot();
  mkdirSync(join(root, DATA), { recursive: true });
  const opts = parseIntArgs(process.argv.slice(2), availableParallelism());
  // F1 (CR-095): `--no-frozen` (cổng hằng ngày) bỏ file int của module đóng băng.
  const noFrozen = process.argv.includes("--no-frozen");
  // Filter nêu tường minh đường dẫn đóng băng ⇒ vẫn chạy (đóng băng chỉ lọc khi không có filter); 0 file ⇒ fail ngay, rõ lý do.
  const sel = resolveIntFiles(await findIntFiles(root), opts.filters, noFrozen, isFrozenFile);
  if (sel.error) {
    console.error(`test:int:par: ${sel.error}`);
    return 2;
  }
  if (sel.unmatched.length)
    console.warn(`test:int:par: CẢNH BÁO filter không khớp file nào: ${sel.unmatched.join(", ")}`);
  if (process.argv.includes("--check-only")) {
    console.log(`test:int:par: filter hợp lệ, ${sel.files.length} file int trong phạm vi`);
    return 0;
  }
  const { parallel, serial } = selectFiles(sel.files, opts.filters);
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
  const hang = parseHangCfg(process.argv.slice(2), process.env);
  const runs = (
    await Promise.all(
      slots.map((s, i) => worker(s, queue, { timings, n, env: envOf(i), hang }, root)),
    )
  ).flat();
  runs.push(...(await serialLanes(serial, slots, envOf, root, hang)));
  lease.release();
  // DB rác (đích cũ khi test đổi schema) xoá theo loạt khi đủ 32 cái: mỗi DROP DATABASE ép checkpoint (đo ~1 s/DB trên máy
  // này ⇒ 30–35 s cho 35–58 DB). TS1: chạy NỀN tách rời (không chặn kết quả); lượt sau không thấy khác biệt vì tên rác duy nhất.
  gcInBackground(root);
  saveTimings(root, runs, timings);
  printSlowest(root, runs);
  let [pass, fail] = [0, 0];
  for (const r of runs) {
    const s = summarize(r);
    pass += s.pass;
    fail += s.fail;
    for (const l of s.fails) console.log(`  [${r.name}] ${l}`);
  }
  const bad = runs.filter((r) => r.code !== 0);
  const hungs = runs.flatMap((r) => (r.hung ? [r.hung] : []));
  if (hungs.length)
    console.log(
      `test:int:par: ${hungs.length} file TREO (bị kill, các file còn lại vẫn chạy):\n${hungs.map((h) => `  ${hangLine(h)}`).join("\n")}`,
    );
  console.log(
    `test:int:par: ${pass} pass, ${fail} fail, ${((performance.now() - t0) / 1000).toFixed(1)} s` +
      (bad.length ? ` — đỏ: ${bad.map((r) => r.name).join(", ")} (log .data/int-s*.log)` : ""),
  );
  // Đỏ MỚI in riêng với đỏ cũ (tests/known-red.json); mã thoát chỉ tính đỏ mới khi `--quarantine`/TEST_QUARANTINE=1.
  return reportReds({
    root,
    label: "test:int:par",
    // "(unhandled)" (lỗi ngoài ca) không bao giờ khớp mục known-red ⇒ luôn là đỏ mới.
    reds: bad.flatMap((r) => [
      ...intReds(r.text),
      ...summarize(r)
        .fails.filter((l) => l.startsWith("(unhandled)") || l.startsWith("(treo)"))
        .map((name) => ({ suite: "int", name })),
    ]),
    unattributed: bad.filter((r) => summarize(r).fails.length === 0).length,
    quarantine: quarantineOn(process.argv.slice(2), process.env),
  });
}

process.exit(await main());
