// e2e-isolation · phần I/O của làn e2e: đăng ký làn toàn máy, thuê Redis DB, quét/giết cây tiến trình.
// Luật thuần ở `e2e-lane.rules.ts`. Kho trạng thái: %TEMP%/evolu-e2e (toàn máy, cùng người dùng).
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  allocateLane,
  descendants,
  type Listen,
  leaseStale,
  type Proc,
  pickRedisDb,
  pruneRegistry,
  REDIS_POOL,
  type Registry,
  reapTargets,
} from "./e2e-lane.rules";

const STATE = join(tmpdir(), "evolu-e2e");
const REG = join(STATE, "lanes.json");
const LOCK = join(STATE, "lanes.lock");
export const LANE_FILE = ".e2e-lane";

const sleepSync = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** Khoá toàn máy bằng mkdir nguyên tử; khoá cũ hơn 30 s coi là bỏ rơi. */
function withLock<T>(f: () => T): T {
  mkdirSync(STATE, { recursive: true });
  for (let i = 0; ; i++) {
    try {
      mkdirSync(LOCK);
      break;
    } catch {
      try {
        if (Date.now() - statSync(LOCK).mtimeMs > 30_000) rmSync(LOCK, { recursive: true });
      } catch {}
      if (i > 600) throw new Error("không lấy được khoá làn e2e");
      sleepSync(50);
    }
  }
  try {
    return f();
  } finally {
    rmSync(LOCK, { recursive: true, force: true });
  }
}

const readReg = (): Registry => {
  try {
    return JSON.parse(readFileSync(REG, "utf8")) as Registry;
  } catch {
    return {};
  }
};

export const isMainCheckout = (root: string): boolean => {
  try {
    return statSync(join(root, ".git")).isDirectory();
  } catch {
    return false;
  }
};

/** Làn của checkout: `E2E_LANE` (ghi đè) > `.e2e-lane` khớp sổ đăng ký > cấp mới (khoá toàn máy). */
export function resolveLane(root: string, env: Record<string, string | undefined> = process.env) {
  const forced = env.E2E_LANE;
  if (forced !== undefined && forced !== "") return Number(forced);
  return withLock(() => {
    const a = allocateLane(readReg(), root, { isMain: isMainCheckout(root), exists: existsSync });
    writeFileSync(REG, JSON.stringify(a.registry, null, 1));
    writeFileSync(join(root, LANE_FILE), `${a.lane}\n`);
    return a.lane;
  });
}

/** `e2e:lanes --prune`: bỏ làn của đường dẫn không còn. Trả (còn, đã bỏ). */
export function pruneLanes(): { kept: Registry; dropped: string[] } {
  return withLock(() => {
    const reg = readReg();
    const kept = pruneRegistry(reg, existsSync);
    writeFileSync(REG, JSON.stringify(kept, null, 1));
    return { kept, dropped: Object.keys(reg).filter((p) => !(p in kept)) };
  });
}

export const listLanes = (): Registry => withLock(readReg);

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const leaseFile = (db: number) => join(STATE, `redis-db${db}.lease`);

/** Redis DB đang được thuê (dọn hợp đồng của chủ đã chết). */
function heldRedisDbs(): Set<number> {
  const held = new Set<number>();
  for (const d of REDIS_POOL) {
    const f = leaseFile(d);
    if (!existsSync(f)) continue;
    try {
      const o = JSON.parse(readFileSync(f, "utf8")) as { pid: number };
      if (leaseStale(o.pid, alive)) unlinkSync(f);
      else held.add(d);
    } catch {
      unlinkSync(f);
    }
  }
  return held;
}

/** Thuê một Redis DB e2e (toàn máy); hết thì chờ và in "đang chờ lane Redis …". Trả hàm nhả. */
export async function leaseRedisDb(owner: string): Promise<{ db: number; release: () => void }> {
  mkdirSync(STATE, { recursive: true });
  let told = false;
  for (;;) {
    const got = withLock(() => {
      const db = pickRedisDb(heldRedisDbs());
      if (db !== undefined)
        writeFileSync(leaseFile(db), JSON.stringify({ pid: process.pid, owner }));
      return db;
    });
    if (got !== undefined)
      return { db: got, release: () => rmSync(leaseFile(got), { force: true }) };
    if (!told) console.log("đang chờ lane Redis (cả 9 DB e2e đang được worktree khác dùng) …");
    told = true;
    await new Promise((r) => setTimeout(r, 1000));
  }
}

const ps = (script: string): string =>
  spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }).stdout;

/** Bảng tiến trình (Windows: CIM; nơi khác: ps). */
export function processTable(): Proc[] {
  if (process.platform !== "win32") {
    const out = spawnSync("ps", ["-eo", "pid=,ppid=,comm=,args="], { encoding: "utf8" }).stdout;
    return out
      .split("\n")
      .map((l) => /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(l))
      .filter((m): m is RegExpExecArray => !!m)
      .map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), name: m[3] ?? "", cmd: m[4] ?? "" }));
  }
  const j = ps(
    "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress",
  );
  type Row = {
    ProcessId: number;
    ParentProcessId: number;
    Name: string;
    CommandLine: string | null;
  };
  try {
    const rows = JSON.parse(j) as Row[];
    return rows.map((r) => ({
      pid: r.ProcessId,
      ppid: r.ParentProcessId,
      name: r.Name,
      cmd: r.CommandLine ?? "",
    }));
  } catch {
    return [];
  }
}

export function listening(): Listen[] {
  if (process.platform !== "win32") return [];
  const j = ps(
    "Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Select-Object LocalPort,OwningProcess | ConvertTo-Json -Compress",
  );
  try {
    const rows = JSON.parse(j) as { LocalPort: number; OwningProcess: number }[];
    return (Array.isArray(rows) ? rows : [rows]).map((r) => ({
      pid: r.OwningProcess,
      port: r.LocalPort,
    }));
  } catch {
    return [];
  }
}

export function killPids(pids: readonly number[]): void {
  for (const p of pids)
    try {
      process.kill(p, "SIGKILL");
    } catch {}
}

/** Giết cả cây con của các PID đã spawn (lá trước), rồi chính chúng. */
export function killTrees(roots: Iterable<number>): void {
  const rs = [...roots].filter(alive);
  if (!rs.length) return;
  const table = processTable();
  killPids([...rs.flatMap((r) => descendants(table, r)), ...rs]);
}

/** Theo dõi PID con; dọn khi thoát thường / lỗi / Ctrl-C / SIGTERM. */
/** Quét thêm bun/node mồ côi của checkout này trong dải cổng của làn (cháu đã mất liên kết cha). */
export function sweepLane(root: string, lane: number): number[] {
  const pids = reapTargets(processTable(), listening(), root, lane, process.pid);
  killPids(pids);
  return pids;
}

export function installCleanup(
  pids: Set<number>,
  root: string,
  lane: number,
  sweep = true,
): () => void {
  let done = false;
  const run = () => {
    if (done) return;
    done = true;
    killTrees(pids);
    if (sweep) sweepLane(root, lane);
  };
  process.on("exit", run);
  for (const s of ["SIGINT", "SIGTERM", "SIGBREAK"] as const)
    process.on(s, () => {
      run();
      process.exit(130);
    });
  return run;
}
