// `bun run res:check [--json] [--server] [--strict]` — đo tài nguyên máy trước khi chạy song song
// (docs/WORKFLOW.md "Kiểm tra tài nguyên trước khi chạy song song"). Luật thuần: res-check.rules.ts.
// Chỉ ĐỌC: không ghi file, không đổi trạng thái máy; ssh chỉ chạy lệnh đọc, không in khoá/bí mật.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statfsSync } from "node:fs";
import { cpus, freemem, loadavg, totalmem } from "node:os";
import { dirname, join, resolve } from "node:path";
import { listLanes, processTable } from "./e2e-lane";
import {
  PS_LOCAL_SCRIPT,
  parseLocalPs,
  parseServerOut,
  parseWorktreeList,
  type RawLocal,
  serverScript,
} from "./res-check.parse";
import {
  countHeavy,
  formatReport,
  type LocalMetrics,
  recommend,
  type ServerMetrics,
} from "./res-check.rules";

const BASE = "platform/gd0";
const SERVER = "evoc@149.202.83.5";
const KEY = "F:\\workspace\\id_evoc_key";
const SERVER_SLOTS = 4;
const MB = 1024 * 1024;

const git = (cwd: string, ...a: string[]) => {
  const p = spawnSync("git", a, { cwd, encoding: "utf8" });
  return { ok: p.status === 0, out: `${p.stdout ?? ""}`.trim() };
};

const norm = (p: string) => resolve(p).replaceAll("\\", "/").toLowerCase();

function rawLocalWin(root: string): RawLocal | undefined {
  const drive = /^([A-Za-z]):/.exec(root)?.[1] ?? "C";
  const script = PS_LOCAL_SCRIPT.replace("{DRIVE}", drive);
  const enc = Buffer.from(script, "utf16le").toString("base64");
  const p = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-EncodedCommand", enc], {
    encoding: "utf8",
    maxBuffer: 64 * MB,
    timeout: 30_000,
  });
  return parseLocalPs(p.stdout ?? "");
}

function rawLocalPosix(root: string): RawLocal {
  const fs = statfsSync(root);
  return {
    cores: cpus().length,
    cpuPct: Math.min(100, ((loadavg()[0] ?? 0) / Math.max(1, cpus().length)) * 100),
    freeRamMb: freemem() / MB,
    totalRamMb: totalmem() / MB,
    freeDiskGb: (fs.bavail * fs.bsize) / 1024 ** 3,
    procs: processTable().map((r) => ({ name: r.name, cmd: r.cmd })),
  };
}

type WtInfo = { total: number; stale: number; orphans: number };

/** Worktree: đăng ký trong git (≠ checkout chính), đã merge vào BASE + sạch + có commit riêng = "stale"; thư mục lạ = mồ côi. */
function worktreeInfo(main: string, root: string): WtInfo {
  const list = parseWorktreeList(git(main, "worktree", "list", "--porcelain").out);
  const wts = list.filter((w) => norm(w.path) !== norm(main));
  const merged = new Set(
    git(main, "branch", "--merged", BASE, "--format=%(refname:short)").out.split(/\r?\n/),
  );
  let stale = 0;
  for (const w of wts) {
    if (!w.branch || !merged.has(w.branch) || norm(w.path) === norm(root)) continue;
    const reflog = git(main, "reflog", "show", "--format=%h", w.branch).out.split(/\r?\n/).length;
    if (reflog > 1 && git(w.path, "status", "--porcelain").out === "") stale++;
  }
  const known = new Set(wts.map((w) => norm(w.path)));
  return { total: wts.length, stale, orphans: countOrphans(main, known) };
}

/** Thư mục con của `evolu-wt` và `.claude/worktrees` không còn đăng ký trong git (dư `node_modules`…). */
function countOrphans(main: string, known: Set<string>): number {
  let n = 0;
  for (const dir of [resolve(main, "..", "evolu-wt"), join(main, ".claude", "worktrees")]) {
    if (!existsSync(dir)) continue;
    for (const e of readdirSync(dir, { withFileTypes: true }))
      if (e.isDirectory() && !known.has(norm(join(dir, e.name)))) n++;
  }
  return n;
}

function mainRoot(cwd: string): string {
  const r = git(cwd, "rev-parse", "--path-format=absolute", "--git-common-dir");
  return r.ok ? dirname(resolve(r.out)) : cwd;
}

/** Đo máy local. Trả `undefined` nếu không đo được (khi đó `slice:new` bỏ qua kiểm). */
export function collectLocal(root: string = process.cwd()): LocalMetrics | undefined {
  const raw = process.platform === "win32" ? rawLocalWin(root) : rawLocalPosix(root);
  if (!raw) return undefined;
  let lanes = 0;
  try {
    lanes = Object.keys(listLanes()).length;
  } catch {}
  return {
    cores: raw.cores,
    load: (raw.cores * raw.cpuPct) / 100,
    freeRamMb: raw.freeRamMb,
    totalRamMb: raw.totalRamMb,
    freeDiskGb: raw.freeDiskGb,
    heavy: countHeavy(raw.procs),
    worktrees: worktreeInfo(mainRoot(root), root),
    lanes,
  };
}

/** Đo máy chủ evotest qua ssh (chỉ lệnh đọc, script qua stdin). */
export function collectServer(slots = SERVER_SLOTS): { metrics?: ServerMetrics; error?: string } {
  if (!existsSync(KEY)) return { error: "không thấy khoá ssh" };
  const p = spawnSync(
    "ssh",
    ["-i", KEY, "-o", "BatchMode=yes", "-o", "ConnectTimeout=8", SERVER, "bash -s"],
    { input: serverScript(slots).replaceAll("\r\n", "\n"), encoding: "utf8", timeout: 30_000 },
  );
  const m = parseServerOut(p.stdout ?? "");
  return m ? { metrics: m } : { error: `ssh lỗi (mã ${p.status ?? "timeout"})` };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const local = collectLocal();
  if (!local) {
    console.error("res:check: không đo được máy local");
    process.exit(0);
  }
  const srv = args.includes("--server") ? collectServer() : {};
  const rec = recommend(local, srv.metrics);
  if (args.includes("--json"))
    console.log(
      JSON.stringify(
        { local, server: srv.metrics ?? null, serverError: srv.error ?? null, recommendation: rec },
        null,
        2,
      ),
    );
  else console.log(formatReport(local, srv.metrics, rec, srv.error).join("\n"));
  process.exit(args.includes("--strict") && rec.hard.length > 0 ? 2 : 0);
}
