// tool-evotest-cache · bash THẬT của deploy/evotest/cache.sh (dọn cache, băm migrations). Chỉ Linux (cần GNU stat/du/touch -d);
// Windows bỏ qua, chạy ở evotest (`run-tests.ps1 -Step int -Filter tools/scripts/src/evotest-cache.int.test.ts`).
import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { migrationsHash } from "../../../packages/db/src/test-db-template";

const REPO = resolve(import.meta.dir, "../../..");
const CACHE = join(REPO, "deploy/evotest/cache.sh");
const ok = process.platform === "linux" && Bun.which("bash") !== null;
const d = ok ? describe : describe.skip;

function sh(script: string, env: Record<string, string> = {}) {
  const p = Bun.spawnSync(["bash", "-c", `. "${CACHE}"\n${script}`], {
    env: { ...process.env, ...env },
  });
  return { rc: p.exitCode, out: p.stdout.toString() + p.stderr.toString() };
}

/** Mục cache giả: <C>/<pool>/<name>/.ref = ref, mtime = now - ageMin phút, `mb` MB (sparse, du -sb tính kích thước danh nghĩa). */
function entry(c: string, pool: string, name: string, ref: string, ageMin: number, mb = 1) {
  const dir = join(c, pool, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, ".ref"), ref);
  Bun.spawnSync(["truncate", "-s", `${mb}M`, join(dir, "data.bin")]);
  Bun.spawnSync(["touch", "-d", `${ageMin} minutes ago`, dir]);
}

d("cache.sh · dbtpl_hash", () => {
  it("khớp migrationsHash() của packages/db (cache nạp đúng thư mục, không hụt vì lệch thuật toán)", () => {
    const { out } = sh(`dbtpl_hash "${REPO}"`);
    expect(out.trim()).toBe(migrationsHash());
  });
});

d("cache.sh · cache_prune", () => {
  const prune = (c: string, keep: number, gb: number, env: Record<string, string> = {}) =>
    sh(`R=x; C="${c}"; cache_prune ${keep} ${gb}`, env);
  const names = (c: string, pool: string) =>
    Bun.spawnSync(["bash", "-c", `ls "${c}/${pool}" 2>/dev/null | sort | tr '\\n' ' '`])
      .stdout.toString()
      .trim();

  it("giữ N ref gần nhất mỗi pool (ref gồm nhiều mục đi cùng nhau), xoá ref cũ hơn", () => {
    const c = mkdtempSync(join(tmpdir(), "evo-prune-"));
    entry(c, "build", "k1", "c-old", 500);
    entry(c, "build", "k2", "c-old", 400);
    entry(c, "build", "k3", "c-mid", 300);
    entry(c, "build", "k4", "c-new", 200);
    entry(c, "build", "k5", "c-new", 100);
    entry(c, "dbtpl", "h1", "h1", 600);
    entry(c, "dbtpl", "h2", "h2", 100);
    const { rc } = prune(c, 2, 6);
    expect(rc).toBe(0);
    expect(names(c, "build")).toBe("k3 k4 k5");
    expect(names(c, "dbtpl")).toBe("h1 h2"); // pool dbtpl chỉ 2 ref ⇒ giữ cả hai
    prune(c, 1, 6);
    expect(names(c, "build")).toBe("k4 k5");
    expect(names(c, "dbtpl")).toBe("h2");
  });

  it("vượt trần GB ⇒ bỏ ref cũ nhất nhưng luôn giữ ref mới nhất của pool", () => {
    const c = mkdtempSync(join(tmpdir(), "evo-prune-"));
    entry(c, "build", "a", "c-a", 300, 700);
    entry(c, "build", "b", "c-b", 200, 700);
    entry(c, "build", "c", "c-c", 100, 700);
    prune(c, 5, 1); // trần 1 GB < 700 MB × 3 ⇒ chỉ còn ref mới nhất (700 MB ≤ 1 GB)
    expect(names(c, "build")).toBe("c");
    prune(c, 5, 0 + 1);
    expect(names(c, "build")).toBe("c");
  });

  it("mục sửa trong EVO_PRUNE_PROTECT_S không bị xoá; .tmp/.lock cũ được dọn, khoá còn nhịp tim thì giữ", () => {
    const c = mkdtempSync(join(tmpdir(), "evo-prune-"));
    entry(c, "build", "fresh-old-ref", "c-1", 2);
    entry(c, "build", "newer", "c-2", 1);
    entry(c, "build", "ancient", "c-0", 900);
    mkdirSync(join(c, "build/.tmp-x-1-a"), { recursive: true });
    Bun.spawnSync(["touch", "-d", "3 hours ago", join(c, "build/.tmp-x-1-a")]);
    mkdirSync(join(c, "build/.lock-dead"));
    Bun.spawnSync(["touch", "-d", "10 minutes ago", join(c, "build/.lock-dead")]);
    mkdirSync(join(c, "build/.lock-live"));
    writeFileSync(join(c, "build/.lock-live/hb"), "1");
    prune(c, 1, 6);
    expect(existsSync(join(c, "build/ancient"))).toBe(false);
    expect(existsSync(join(c, "build/fresh-old-ref"))).toBe(true); // 2 phút < 600 s ⇒ được bảo vệ dù ref bị bỏ
    expect(existsSync(join(c, "build/newer"))).toBe(true);
    expect(existsSync(join(c, "build/.tmp-x-1-a"))).toBe(false);
    expect(existsSync(join(c, "build/.lock-dead"))).toBe(false);
    expect(existsSync(join(c, "build/.lock-live"))).toBe(true);
  });

  it("thư mục cache chưa có ⇒ không lỗi", () => {
    expect(prune(join(tmpdir(), "evo-none-xyz"), 5, 6).rc).toBe(0);
  });
});
