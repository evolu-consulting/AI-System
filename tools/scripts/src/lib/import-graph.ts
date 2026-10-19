// TS1 · đồ thị import của repo cho `test:affected` (nhanh: Bun.Transpiler.scanImports, không phân tích kiểu): cạnh = import
// tĩnh/động/require tới file TRONG repo (tương đối, alias `~/` của app web, gói workspace `@ai/*` qua `exports`). Gói ngoài
// (npm, node:) bỏ qua. Dùng ngược: `affectedBy(graph, changed)` = đóng bao ngược (file đổi + mọi file phụ thuộc trực/gián tiếp).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

export type Graph = {
  /** file → các file nó import (đường dẫn tương đối gốc repo, `/`). */
  deps: Map<string, string[]>;
  /** file → các file import nó. */
  rev: Map<string, Set<string>>;
};

/** Thư mục quét; cả cây `node_modules`, `dist*`, `.turbo`, `.data` bị bỏ. */
export const SCAN_ROOTS = ["apps", "packages", "tools", "tests", "e2e"] as const;
const CODE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const SKIP_DIR =
  /^(node_modules|dist|dist-e2e|\.turbo|\.data|\.git|test-results|__pycache__|\.venv)$/;
/** Đường dẫn file mã viết thẳng trong chuỗi (test spawn server: `bun apps/hub-api/src/server.ts`, `e2e/P-a/_pa-stack.ts`). */
const PATH_LIT = /["'`\s]((?:apps|packages|tools|tests|e2e)\/[\w./@-]+\.(?:tsx?|mjs|js))\b/g;
const EXT = [".ts", ".tsx", ".mts", ".js", ".jsx", ".mjs", ".json"];

export const posix = (p: string): string => p.replaceAll("\\", "/");

function walk(root: string, dir: string, out: string[]): void {
  for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!SKIP_DIR.test(e.name)) walk(root, `${dir}/${e.name}`, out);
    } else if (CODE.test(e.name)) out.push(`${dir}/${e.name}`);
  }
}

/** Mọi file mã dưới SCAN_ROOTS + `playwright.config.ts` gốc. */
export function listCodeFiles(root: string): string[] {
  const out: string[] = [];
  for (const d of SCAN_ROOTS) if (existsSync(join(root, d))) walk(root, d, out);
  if (existsSync(join(root, "playwright.config.ts"))) out.push("playwright.config.ts");
  return out;
}

type Pkg = { dir: string; exports: unknown; main?: string };

/** Tên gói workspace → thư mục + `exports` (apps/*, packages/*, tools/*). */
export function workspacePackages(root: string): Map<string, Pkg> {
  const out = new Map<string, Pkg>();
  for (const group of ["apps", "packages", "tools"]) {
    if (!existsSync(join(root, group))) continue;
    for (const e of readdirSync(join(root, group), { withFileTypes: true })) {
      const pj = join(root, group, e.name, "package.json");
      if (!e.isDirectory() || !existsSync(pj)) continue;
      const j = JSON.parse(readFileSync(pj, "utf8")) as {
        name?: string;
        exports?: unknown;
        main?: string;
      };
      if (j.name) out.set(j.name, { dir: `${group}/${e.name}`, exports: j.exports, main: j.main });
    }
  }
  return out;
}

const isFile = (p: string): boolean => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

/** Thử các hậu tố/`index` (kể cả `.js` → `.ts` của ESM TS). Trả đường dẫn tương đối gốc hoặc undefined. */
export function tryFile(root: string, rel: string): string | undefined {
  const cands = [rel, ...EXT.map((x) => rel + x), ...EXT.map((x) => `${rel}/index${x}`)];
  const m = /^(.*)\.(m?js|jsx)$/.exec(rel);
  if (m?.[1]) cands.push(`${m[1]}.ts`, `${m[1]}.tsx`);
  const hit = cands.find((c) => isFile(join(root, c)));
  return hit ? posix(hit) : undefined;
}

/** Đích của một khoá/giá trị `exports` (chuỗi hoặc điều kiện lồng nhau). */
function exportTarget(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (v && typeof v === "object")
    for (const k of ["import", "bun", "default", "types"]) {
      const r = exportTarget((v as Record<string, unknown>)[k]);
      if (r) return r;
    }
  return undefined;
}

/** Khoá `exports` dạng wildcard (`./x/*`) khớp `key` ⇒ đích đã thay `*`. */
function viaWildcard(pkg: Pkg, map: Record<string, unknown>, key: string): string | undefined {
  for (const [pat, val] of Object.entries(map)) {
    const star = pat.indexOf("*");
    if (star < 0 || !key.startsWith(pat.slice(0, star)) || !key.endsWith(pat.slice(star + 1)))
      continue;
    const mid = key.slice(star, key.length - (pat.length - star - 1));
    const t = exportTarget(val);
    if (t) return join(pkg.dir, t.replace("*", mid));
  }
  return undefined;
}

function viaExports(pkg: Pkg, sub: string): string | undefined {
  const ex = pkg.exports;
  const key = sub ? `./${sub}` : ".";
  if (typeof ex === "string" && !sub) return join(pkg.dir, ex);
  if (ex && typeof ex === "object") {
    const map = ex as Record<string, unknown>;
    const direct = exportTarget(map[key]);
    if (direct) return join(pkg.dir, direct);
    const wild = viaWildcard(pkg, map, key);
    if (wild) return wild;
  }
  return sub ? join(pkg.dir, sub) : join(pkg.dir, pkg.main ?? "src/index.ts");
}

/** Phân giải một specifier từ file `from` (tương đối gốc repo) tới file trong repo; ngoài repo ⇒ undefined. */
export function resolveSpecifier(
  root: string,
  pkgs: Map<string, Pkg>,
  from: string,
  spec: string,
): string | undefined {
  if (spec.startsWith("."))
    return tryFile(root, posix(relative(root, resolve(root, dirname(from), spec))));
  if (spec.startsWith("~/")) {
    const app = /^(apps\/[^/]+)\//.exec(from)?.[1];
    return app ? tryFile(root, `${app}/src/${spec.slice(2)}`) : undefined;
  }
  const m = /^(@ai\/[^/]+)(?:\/(.+))?$/.exec(spec);
  const pkg = m?.[1] ? pkgs.get(m[1]) : undefined;
  if (!pkg) return undefined;
  const target = viaExports(pkg, m?.[2] ?? "");
  return target ? tryFile(root, posix(target)) : undefined;
}

type Scanner = { ts: Bun.Transpiler; tsx: Bun.Transpiler };

/** Các file trong repo mà `file` (nội dung `text`) trỏ tới: import tĩnh/động/require + đường dẫn mã viết thẳng trong chuỗi. */
function edgesOf(root: string, pkgs: Map<string, Pkg>, sc: Scanner, file: string): Set<string> {
  const text = readFileSync(join(root, file), "utf8");
  let imports: { path: string }[] = [];
  try {
    imports = (/\.(tsx|jsx)$/.test(file) ? sc.tsx : sc.ts).scanImports(text);
  } catch {
    // file không phân tích được: coi như không có cạnh (không chặn cả lượt)
  }
  const hits = [
    ...imports.map((i) => resolveSpecifier(root, pkgs, file, i.path)),
    ...[...text.matchAll(PATH_LIT)].map((m) => (m[1] ? tryFile(root, m[1]) : undefined)),
  ];
  return new Set(hits.filter((r): r is string => r !== undefined && r !== file));
}

export function buildGraph(root: string): Graph {
  const pkgs = workspacePackages(root);
  const sc: Scanner = {
    ts: new Bun.Transpiler({ loader: "ts" }),
    tsx: new Bun.Transpiler({ loader: "tsx" }),
  };
  const deps = new Map<string, string[]>();
  const rev = new Map<string, Set<string>>();
  for (const file of listCodeFiles(root)) {
    const out = edgesOf(root, pkgs, sc, file);
    deps.set(file, [...out]);
    for (const d of out) {
      const s = rev.get(d) ?? new Set<string>();
      s.add(file);
      rev.set(d, s);
    }
  }
  return { deps, rev };
}

/** Đóng bao ngược từ `changed` (gồm chính chúng). */
export function affectedBy(g: Graph, changed: Iterable<string>): Set<string> {
  const seen = new Set<string>();
  const queue = [...changed];
  for (let f = queue.pop(); f !== undefined; f = queue.pop()) {
    if (seen.has(f)) continue;
    seen.add(f);
    for (const r of g.rev.get(f) ?? []) if (!seen.has(r)) queue.push(r);
  }
  return seen;
}

/** Đóng bao xuôi (mọi file `from` phụ thuộc, gồm chính nó) — dùng để biết cấu hình e2e chạm những file nào. */
export function reachableFrom(g: Graph, from: Iterable<string>): Set<string> {
  const seen = new Set<string>();
  const queue = [...from];
  for (let f = queue.pop(); f !== undefined; f = queue.pop()) {
    if (seen.has(f)) continue;
    seen.add(f);
    for (const d of g.deps.get(f) ?? []) if (!seen.has(d)) queue.push(d);
  }
  return seen;
}
