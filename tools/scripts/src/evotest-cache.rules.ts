// tool-evotest-cache · luật thuần của cache dựng chung trên evotest (không chạm đĩa; IO ở evotest-cache.lib.ts).
// Khoá bản dựng = pkg + định danh mã nguồn (commit sạch ⇒ `c-<commit>`; chạy -Dirty ⇒ `h-<băm nội dung>`) + băm bun.lock +
// bản bun + các biến môi trường được nhúng vào bundle (PUBLIC_*, NODE_ENV).
import { sha256 } from "./evotest-cache.hash";

export { sha256 };

/** Biến môi trường đổi NỘI DUNG bản dựng web: rsbuild nhúng `PUBLIC_*` vào bundle; NODE_ENV đổi chế độ dựng. Cổng/URL proxy (HUB_URL…) chỉ dùng lúc preview ⇒ không vào khoá. */
export function buildEnvSubset(
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of Object.keys(env).sort()) {
    const v = env[k];
    if (v !== undefined && (k.startsWith("PUBLIC_") || k === "NODE_ENV")) out[k] = v;
  }
  return out;
}

const COMMIT_RE = /^[0-9a-f]{7,40}$/;

/** `VERSION` của evotest = `<commit>` (sạch) hoặc `<commit>+dirty`. Sạch ⇒ khoá theo commit; còn lại ⇒ theo băm nội dung. */
export function srcId(version: string | undefined, contentHash: () => string): string {
  const v = (version ?? "").trim();
  if (COMMIT_RE.test(v)) return `c-${v}`;
  return `h-${contentHash().slice(0, 20)}`;
}

export type BuildKeyIn = {
  pkg: string;
  srcId: string;
  lockHash: string;
  toolchain: string;
  env: Readonly<Record<string, string | undefined>>;
};

/** Khoá thư mục cache của một bản dựng (24 hex): đổi bất kỳ thành phần nào ⇒ khoá khác. */
export function buildKey(i: BuildKeyIn): string {
  const canon = JSON.stringify([i.pkg, i.srcId, i.lockHash, i.toolchain, buildEnvSubset(i.env)]);
  return sha256(canon).slice(0, 24);
}

/** Đường dẫn (posix, tương đối gốc repo) bị loại khỏi băm nội dung: sinh ra lúc dựng/chạy hoặc không ảnh hưởng bundle. */
export function hashExcluded(rel: string): boolean {
  const parts = rel.split("/");
  const name = parts[parts.length - 1] ?? "";
  if (parts.some((p) => p === "node_modules" || p === ".turbo" || p === ".git" || p === ".data"))
    return true;
  if (parts.some((p) => p === "dist" || p.startsWith("dist-") || p === "coverage")) return true;
  if (name.endsWith(".gen.ts") || name.endsWith(".gen.tsx")) return true; // routeTree.gen.ts: sinh trong lúc dựng
  if (/\.(test|spec|int\.test|perf\.int\.test)\.tsx?$/.test(name)) return true;
  return false;
}

/** Tên gói → "apps/x" (thư mục workspace) từ danh sách {dir, name}; không thấy ⇒ undefined. */
export function pkgDirOf(
  pkgs: readonly { dir: string; name: string }[],
  pkg: string,
): string | undefined {
  return pkgs.find((p) => p.name === pkg)?.dir;
}

/** Script `build` của app web trong repo (KHÔNG đổi ở nhánh/prod/local) và bản đi qua cache chỉ được ghi vào BẢN SAO tạm trên evotest (`patch-build-scripts`). */
export const PLAIN_BUILD = "rsbuild build";
export const CACHED_BUILD = "bun ../../tools/scripts/src/evotest-cache.ts app-build";

/** `rsbuild build` → lệnh qua cache; script khác (hoặc vắng) giữ nguyên. */
export function patchBuildScript(build: string | undefined): string | undefined {
  return build === PLAIN_BUILD ? CACHED_BUILD : build;
}

export type BuildStat = {
  pkg: string;
  result: "hit" | "miss" | "wait";
  ms: number;
  copyMs: number;
  key: string;
};

/** Dòng tóm tắt in cuối lượt: `build-cache: 7 hit, 2 miss, 1 chờ bản dựng của lượt khác (dựng 63 s, chép 1.4 s)`. */
export function summarizeStats(stats: readonly BuildStat[]): string {
  if (stats.length === 0) return "build-cache: không có lượt dựng nào đi qua cache";
  const n = (r: BuildStat["result"]) => stats.filter((s) => s.result === r).length;
  const sec = (ms: number) => (ms / 1000).toFixed(1);
  const built = stats.filter((s) => s.result === "miss").reduce((a, s) => a + s.ms, 0);
  const waited = stats.filter((s) => s.result === "wait").reduce((a, s) => a + s.ms, 0);
  const copy = stats.reduce((a, s) => a + s.copyMs, 0);
  return `build-cache: ${n("hit")} hit, ${n("miss")} miss, ${n("wait")} chờ lượt khác (dựng ${sec(built)} s, chờ ${sec(waited)} s, chép ${sec(copy)} s)`;
}

export type CacheEntry = { name: string; ref: string; mtimeMs: number; bytes: number };

/**
 * Chọn mục cache cần xoá: giữ `keep` ref dùng gần nhất (ref = commit/băm; nhiều mục cùng ref đi cùng nhau), rồi nếu tổng
 * vẫn quá `maxBytes` thì bỏ tiếp ref cũ nhất (luôn giữ ref mới nhất). Mục sửa gần đây (< protectMs) không bao giờ bị xoá.
 * Bản bash `cache_prune` (deploy/evotest/cache.sh) làm cùng việc trên máy chủ; test hai bên giữ chúng khớp.
 */
export function planEviction(
  entries: readonly CacheEntry[],
  o: { keep: number; maxBytes: number; now: number; protectMs: number },
): string[] {
  const refs = new Map<string, { last: number; bytes: number; names: string[] }>();
  for (const e of entries) {
    const r = refs.get(e.ref) ?? { last: 0, bytes: 0, names: [] };
    r.last = Math.max(r.last, e.mtimeMs);
    r.bytes += e.bytes;
    r.names.push(e.name);
    refs.set(e.ref, r);
  }
  const order = [...refs.entries()].sort((a, b) => b[1].last - a[1].last); // mới → cũ
  const drop = new Set<string>();
  for (const [ref] of order.slice(Math.max(1, o.keep))) drop.add(ref);
  let total = order.filter(([ref]) => !drop.has(ref)).reduce((a, [, r]) => a + r.bytes, 0);
  for (let i = order.length - 1; i > 0 && total > o.maxBytes; i--) {
    const [ref, r] = order[i] as [string, { bytes: number }];
    if (drop.has(ref)) continue;
    drop.add(ref);
    total -= r.bytes;
  }
  const byName = new Map(entries.map((e) => [e.name, e]));
  const out: string[] = [];
  for (const ref of drop)
    for (const name of refs.get(ref)?.names ?? [])
      if (o.now - (byName.get(name)?.mtimeMs ?? 0) >= o.protectMs) out.push(name);
  return out.sort();
}
