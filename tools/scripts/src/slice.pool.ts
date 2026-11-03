// slice:pool · hồ bơi worktree ấm: giữ N worktree `<evolu-wt>/_pool/<n>` (detached HEAD tại platform/gd0, đã `bun install`)
// để `slice:new` lấy một cái (git worktree move + checkout -b) thay vì dựng 1–2 phút. Không import slice.ts (slice.ts chạy lệnh khi nạp).
//   bun run slice:pool [--size N]   bổ sung hồ bơi tới N (mặc định 3); đĩa < 30 GB ⇒ không dựng.
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { collectLocal } from "./res-check";
import { parseWorktreeList } from "./res-check.parse";
import { canBuild, missingNames, parsePoolSize, pickReady } from "./slice.pool.rules";

const BASE = "platform/gd0";
const norm = (p: string) => resolve(p).replaceAll("\\", "/").toLowerCase();

function git(cwd: string, ...a: string[]): { ok: boolean; out: string } {
  const p = spawnSync("git", a, { cwd, encoding: "utf8" });
  return { ok: p.status === 0, out: `${p.stdout ?? ""}${p.stderr ?? ""}`.trim() };
}

export const poolRoot = (main: string): string => resolve(main, "..", "evolu-wt", "_pool");
const readyFile = (main: string, n: string) => join(poolRoot(main), `${n}.ready`);

/** Tên (số) của thư mục worktree đang đăng ký trong git dưới `_pool`. */
function registered(main: string): Set<string> {
  const root = norm(poolRoot(main));
  const out = new Set<string>();
  for (const w of parseWorktreeList(git(main, "worktree", "list", "--porcelain").out)) {
    const p = norm(w.path);
    if (dirname(p) === root) out.add(p.slice(root.length + 1));
  }
  return out;
}

/** Lấy một worktree ấm về `dir` trên nhánh mới `branch` tại đầu platform/gd0. `false` ⇒ không có/không dùng được (gọi nơi dựng bình thường). */
export function takeFromPool(main: string, dir: string, branch: string): boolean {
  const root = poolRoot(main);
  if (!existsSync(root)) return false;
  const reg = registered(main);
  const ready = new Set(
    readdirSync(root)
      .filter((f) => f.endsWith(".ready"))
      .map((f) => f.slice(0, -".ready".length)),
  );
  if (git(main, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}`).ok) return false; // để đường thường báo lỗi trùng nhánh
  const n = pickReady(readdirSync(root), ready, reg);
  if (n === undefined) return false;
  const from = join(root, n);
  rmSync(readyFile(main, n), { force: true }); // lấy rồi thì không ai khác lấy nữa
  const mv = git(main, "worktree", "move", from, dir);
  if (!mv.ok) {
    console.warn(`slice: không chuyển được worktree ấm ${n} (${mv.out}); dựng bình thường`);
    return false;
  }
  const co = git(dir, "checkout", "-q", "-b", branch, BASE);
  if (!co.ok) {
    console.warn(`slice: checkout từ hồ bơi lỗi (${co.out}); dựng bình thường`);
    git(main, "worktree", "remove", "--force", dir);
    rmSync(dir, { recursive: true, force: true });
    git(main, "worktree", "prune");
    return false;
  }
  console.log(
    `slice: lấy worktree ấm _pool/${n} (còn ${Math.max(0, ready.size - 1)} sẵn trong hồ bơi)`,
  );
  return true;
}

/** Khoá bổ sung: `mkdir _pool/.lock` + owner pid; khoá của tiến trình đã chết bị gỡ. */
function lockPool(main: string): (() => void) | undefined {
  const root = poolRoot(main);
  mkdirSync(root, { recursive: true });
  const lock = join(root, ".lock");
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      mkdirSync(lock);
      writeFileSync(join(lock, "owner"), String(process.pid));
      return () => rmSync(lock, { recursive: true, force: true });
    } catch {
      let pid = 0;
      try {
        pid = Number(readFileSync(join(lock, "owner"), "utf8").trim());
      } catch {}
      let alive = false;
      try {
        process.kill(pid, 0);
        alive = pid > 0;
      } catch {}
      if (alive) return undefined;
      rmSync(lock, { recursive: true, force: true });
    }
  }
  return undefined;
}

/** Bổ sung hồ bơi tới `size`. Trả số worktree đã dựng thêm. */
export function buildPool(main: string, size: number): number {
  const unlock = lockPool(main);
  if (!unlock) {
    console.log("slice:pool: đang có tiến trình khác bổ sung hồ bơi, bỏ qua");
    return 0;
  }
  try {
    let built = 0;
    for (const n of missingNames(size, sweepPool(main))) {
      let free: number | undefined;
      try {
        free = collectLocal()?.freeDiskGb;
      } catch {}
      const gate = canBuild(free);
      if (!gate.ok) {
        console.warn(`slice:pool: dừng, ${gate.reason}`);
        break;
      }
      if (!buildOne(main, n)) break;
      built++;
    }
    return built;
  } finally {
    unlock();
  }
}

/** Dọn mục dựng dở (thư mục mồ côi, mục chưa `.ready`); trả tên các mục còn lại (đã sẵn sàng). */
function sweepPool(main: string): string[] {
  git(main, "worktree", "prune");
  const root = poolRoot(main);
  const reg = registered(main);
  for (const e of readdirSync(root, { withFileTypes: true }))
    if (e.isDirectory() && /^\d+$/.test(e.name) && !reg.has(e.name))
      rmSync(join(root, e.name), { recursive: true, force: true });
  for (const n of [...reg])
    if (!existsSync(readyFile(main, n))) {
      git(main, "worktree", "remove", "--force", join(root, n));
      rmSync(join(root, n), { recursive: true, force: true });
      reg.delete(n);
    }
  git(main, "worktree", "prune");
  return [...reg];
}

/** Dựng một worktree ấm `_pool/<n>`: detached tại BASE + bun install + dấu `.ready`. `false` ⇒ lỗi (đã dọn). */
function buildOne(main: string, n: string): boolean {
  const dir = join(poolRoot(main), n);
  const t0 = Date.now();
  const add = git(main, "worktree", "add", "--detach", dir, BASE);
  if (!add.ok) {
    console.warn(`slice:pool: worktree add lỗi: ${add.out}`);
    return false;
  }
  const inst = spawnSync("bun", ["install"], { cwd: dir, encoding: "utf8" });
  if (inst.status !== 0) {
    console.warn(`slice:pool: bun install lỗi (${n}); gỡ`);
    git(main, "worktree", "remove", "--force", dir);
    rmSync(dir, { recursive: true, force: true });
    return false;
  }
  writeFileSync(readyFile(main, n), String(Date.now()));
  console.log(`slice:pool: _pool/${n} sẵn sàng (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  return true;
}

/** Bổ sung nền, không chặn (tiến trình tách rời, log ở `_pool/refill.log`). */
export function spawnRefill(main: string, script: string, size?: number): void {
  try {
    mkdirSync(poolRoot(main), { recursive: true });
    const args = [script, "pool", ...(size ? ["--size", String(size)] : [])];
    const log = openSync(join(poolRoot(main), "refill.log"), "a");
    const p = spawn("bun", args, {
      cwd: main,
      detached: true,
      stdio: ["ignore", log, log],
      windowsHide: true,
    });
    p.unref();
    console.log("slice: bổ sung hồ bơi nền (log: evolu-wt/_pool/refill.log)");
  } catch (e) {
    console.warn(`slice: không bật được bổ sung nền (${(e as Error).message})`);
  }
}

/** Lệnh `slice pool [--size N]`. `--size` được nhớ (`_pool/size`) cho lần bổ sung nền sau `slice:new`. */
export function cmdPool(main: string, flags: readonly string[]): void {
  const s = parsePoolSize(flags);
  if ("error" in s) {
    console.error(`slice: ${s.error}`);
    process.exit(1);
  }
  const sizeFile = join(poolRoot(main), "size");
  if (flags.some((f) => f.startsWith("--size"))) {
    mkdirSync(poolRoot(main), { recursive: true });
    writeFileSync(sizeFile, String(s.size));
  } else if (existsSync(sizeFile)) {
    const saved = parsePoolSize(["--size", readFileSync(sizeFile, "utf8").trim()]);
    if ("size" in saved) s.size = saved.size;
  }
  const t0 = Date.now();
  const n = buildPool(main, s.size);
  console.log(
    `slice:pool: dựng thêm ${n}, mục tiêu ${s.size}, ${((Date.now() - t0) / 1000).toFixed(0)} s`,
  );
}
