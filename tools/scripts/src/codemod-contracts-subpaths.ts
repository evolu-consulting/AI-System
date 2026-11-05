// CR-121 phần B-2 · ADR-0037 · `bun tools/scripts/src/codemod-contracts-subpaths.ts [--check]`
// Thay `import {…} from "@ai/contracts"` (barrel gốc) bằng subpath đúng (`@ai/contracts/access`, `/chat`…) trên toàn repo,
// và thêm `exports` thiếu vào packages/contracts/package.json. Chạy lại được (idempotent): sau lần đầu, các file
// đã sạch không bị đụng. `--check` chỉ báo file còn import barrel gốc (exit 1 nếu có), không ghi.
// Dạng không đổi được an toàn (`import * as C`, tên không rõ nguồn) được liệt kê và giữ nguyên.
// Sau khi chạy: `bunx biome check --write <file đã đổi>` (in ra danh sách ở cuối).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import {
  exportTarget,
  type Resolver,
  ROOT_SPEC,
  rewriteSource,
  subpathOfFile,
} from "./codemod-contracts-subpaths.rules";
import { git, repoRoot } from "./lib/git";

const PKG = "packages/contracts";
const CODE = /\.(ts|tsx)$/;

/** Tên export của barrel gốc → subpath của file khai báo (theo đồ thị TS thật, qua `export *`). */
export function buildResolver(root: string): { resolve: Resolver; used: Set<string> } {
  const entry = join(root, PKG, "src/index.ts");
  const program = ts.createProgram([entry], {
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowImportingTsExtensions: true,
  });
  const checker = program.getTypeChecker();
  const sf = program.getSourceFile(entry);
  const mod = sf && checker.getSymbolAtLocation(sf);
  const map = new Map<string, string>();
  const srcDir = join(root, PKG, "src").replace(/\\/g, "/");
  for (const sym of mod ? checker.getExportsOfModule(mod) : []) {
    const real = sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym;
    const file = real.declarations?.[0]?.getSourceFile().fileName.replace(/\\/g, "/");
    if (file?.startsWith(`${srcDir}/`)) {
      map.set(sym.name, subpathOfFile(file.slice(srcDir.length + 1)));
    }
  }
  const used = new Set<string>();
  const resolve: Resolver = (name) => {
    const s = map.get(name);
    if (s) used.add(s);
    return s;
  };
  return { resolve, used };
}

function dirOfSubpath(root: string): (s: string) => string | null {
  return (s) => {
    const dir = s === "community" ? "pack-community" : s;
    return existsSync(join(root, PKG, "src", dir, "index.ts")) ? dir : null;
  };
}

/** Thêm subpath thiếu vào `exports`; trả về danh sách subpath mới. */
export function ensureExports(root: string, used: Set<string>, write: boolean): string[] {
  const file = join(root, PKG, "package.json");
  const pkg = JSON.parse(readFileSync(file, "utf8")) as { exports: Record<string, string> };
  const added: string[] = [];
  const dirOf = dirOfSubpath(root);
  for (const s of [...used].sort()) {
    if (pkg.exports[`./${s}`]) continue;
    pkg.exports[`./${s}`] = exportTarget(s, dirOf);
    added.push(s);
  }
  if (write && added.length > 0) {
    const sorted = Object.fromEntries(
      Object.entries(pkg.exports).sort(([a], [b]) =>
        a === "." ? -1 : b === "." ? 1 : a.localeCompare(b),
      ),
    );
    pkg.exports = sorted;
    writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
  }
  return added;
}

function trackedCode(root: string): string[] {
  const r = git(["ls-files", "--", "*.ts", "*.tsx"], root);
  return r.out
    .split("\n")
    .map((l) => l.trim())
    .filter((p) => p && CODE.test(p) && !p.startsWith(`${PKG}/`));
}

type Summary = { changed: string[]; skipped: [string, string][]; remaining: string[] };

function run(root: string, check: boolean): Summary {
  const { resolve, used } = buildResolver(root);
  const out: Summary = { changed: [], skipped: [], remaining: [] };
  for (const rel of trackedCode(root)) {
    const abs = join(root, rel);
    const src = readFileSync(abs, "utf8");
    if (!src.includes(ROOT_SPEC)) continue;
    const r = rewriteSource(src, resolve, rel);
    for (const s of r.skipped) out.skipped.push([rel, s]);
    if (check) {
      if (r.changed) out.remaining.push(rel);
      continue;
    }
    if (r.changed) {
      writeFileSync(abs, r.text);
      out.changed.push(rel);
    }
  }
  if (!check) ensureExports(root, used, true);
  return out;
}

function main(argv: string[]): number {
  const check = argv.includes("--check");
  const s = run(repoRoot(), check);
  for (const [f, line] of s.skipped) console.log(`  giữ nguyên ${f}: ${line}`);
  if (check) {
    for (const f of s.remaining) console.log(`  còn barrel gốc: ${f}`);
    console.log(
      `codemod-contracts-subpaths --check: ${s.remaining.length} file còn import barrel gốc`,
    );
    return s.remaining.length > 0 ? 1 : 0;
  }
  console.log(
    `codemod-contracts-subpaths: đã đổi ${s.changed.length} file, giữ nguyên ${s.skipped.length} câu`,
  );
  if (s.changed.length > 0) console.log(`CHANGED:\n${s.changed.join("\n")}`);
  return 0;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
