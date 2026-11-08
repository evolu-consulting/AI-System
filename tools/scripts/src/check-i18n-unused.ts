// CR-125 c3 · `bun run check:i18n-unused` (CHỈ BÁO CÁO; `--strict` ⇒ đỏ khi có khoá thừa): khoá locale vi không xuất hiện trong mã nguồn.
// Coi là DÙNG khi: (a) một chuỗi trong mã bằng khoá đầy đủ hoặc một hậu tố ≥ 2 đoạn của nó; (b) chuỗi mã kết thúc bằng "." là tiền tố
// động (`t(\`a.b.${x}\`)`) của khoá; (c) chuỗi mã bằng một tổ tiên của khoá (namespace/returnObjects).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "./lib/git";
import { readLocaleEntries } from "./lib/locale-files";

const SRC_ROOTS = ["apps", "packages"];
const SKIP_DIRS = new Set(["node_modules", "dist", "locales", "build", ".turbo"]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return SKIP_DIRS.has(n) ? [] : walk(p);
    return /\.(ts|tsx)$/.test(n) && !/\.(test|spec|cs|cw|pa|fnr)\.tsx?$/.test(n) ? [p] : [];
  });
}

/** Mọi chuỗi literal trông như khoá (a.b hoặc tiền tố `a.b.`) trong mã. */
export function collectLiterals(src: string, into: Set<string>): void {
  for (const m of src.matchAll(/["'`]([A-Za-z_][\w-]*(?:\.[\w-]*)+)(?=["'`]|\$\{)/g))
    into.add(m[1] ?? "");
}

export function isUsed(key: string, literals: Set<string>, prefixes: string[]): boolean {
  const parts = key.split(".");
  for (let i = 0; i <= parts.length - 2; i++)
    if (literals.has(parts.slice(i).join("."))) return true; // đầy đủ / hậu tố ≥ 2 đoạn
  for (let n = 1; n < parts.length; n++) if (literals.has(parts.slice(0, n).join("."))) return true; // tổ tiên (không dấu chấm cuối)
  return prefixes.some((p) => key.startsWith(p));
}

export function findUnused(keys: string[], literals: Set<string>): string[] {
  const prefixes = [...literals].filter((l) => l.endsWith("."));
  return keys.filter((k) => !isUsed(k, literals, prefixes));
}

function main(): number {
  const root = repoRoot();
  const literals = new Set<string>();
  for (const r of SRC_ROOTS) {
    const dir = join(root, r);
    for (const f of walk(dir)) collectLiterals(readFileSync(f, "utf8"), literals);
  }
  const keys = [
    ...new Set(
      readLocaleEntries(root)
        .filter((e) => e.lang === "vi")
        .map((e) => e.key),
    ),
  ];
  const unused = findUnused(keys, literals);
  const byPrefix = new Map<string, number>();
  for (const k of unused)
    byPrefix.set(
      k.split(".").slice(0, 3).join("."),
      (byPrefix.get(k.split(".").slice(0, 3).join(".")) ?? 0) + 1,
    );
  const top = [...byPrefix].sort((a, b) => b[1] - a[1]).slice(0, 25);
  for (const [p, n] of top) console.log(`i18n-unused: ${p}.* — ${n} khoá`);
  console.log(
    `i18n-unused: ${unused.length}/${keys.length} khoá không thấy trong mã (báo cáo; --strict để chặn)`,
  );
  return process.argv.includes("--strict") && unused.length > 0 ? 1 : 0;
}

if (import.meta.main) process.exit(main());
