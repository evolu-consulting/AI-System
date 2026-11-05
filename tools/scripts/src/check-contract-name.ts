// CR-121 Q-4 · `bun run check:contract-name`: "tên HĐ" trong SQL của gói contracts chỉ có MỘT định nghĩa
// (`adapters/contract-name.sql.ts`). Cột `contracts.title` là TÊN FILE lúc tải lên; tên HĐ thật nằm ở `fields.title`.
// Chặn tái phát: (1) tự viết lại biểu thức trên `fields -> 'title'`, (2) đọc thô `c.title` mà không qua `contractNameSql`.
// Chỗ thật sự cần tên file/cột thô phải có trong `ALLOWLIST` (kèm lý do, số lần tối đa).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { repoRoot } from "./lib/git";

export const PACK_DIR = "apps/hub-api/src/modules/packs/contracts";
const DEFINITION = "adapters/contract-name.sql.ts";

/** Tên HĐ tự viết lại (đọc `fields.title`) hoặc cột `title` thô của HĐ (bí danh `c`/`pc`/`fc`). */
export const PATTERNS: { re: RegExp; msg: string }[] = [
  {
    re: /fields\s*->>?\s*'title'/,
    msg: "tự viết biểu thức tên HĐ (fields.title) — dùng contractNameSql/contractLabelSql",
  },
  {
    re: /\b(?:c|pc|fc)\.title\b/,
    msg: "đọc cột `title` (tên file) — dùng contractNameSql, hoặc thêm vào ALLOWLIST nếu cần tên file",
  },
];

/** Chỗ được phép: `file` (tính từ packs/contracts) + số lần tối đa + lý do. */
export const ALLOWLIST: { file: string; max: number; reason: string }[] = [
  {
    file: "adapters/todo.repo.ts",
    max: 4,
    reason:
      "CTE chiếu cột thô (fields, number, title) để `contractNameSql(c)` ở truy vấn ngoài tính tên HĐ",
  },
  {
    file: "adapters/upload-contract.repo.ts",
    max: 1,
    reason: "tên file: bản mới (v n+1) kế thừa cột `title` (tên file) của bản cũ",
  },
  {
    file: "cks/adapters/cks-write.repo.ts",
    max: 1,
    reason: "`c` là đối tượng TS đầu vào (tên chứng từ CKS), không phải cột contracts.title",
  },
];

export type Finding = { file: string; line: number; msg: string };

/** Chỉ quét file có SQL (import drizzle) — domain/application thuần TS không đọc cột. */
export const carriesSql = (src: string) => /from "drizzle-orm"/.test(src);

export function scanFile(file: string, src: string): Finding[] {
  const out: Finding[] = [];
  src.split("\n").forEach((raw, i) => {
    const t = raw.trim();
    if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return;
    const code = raw.replace(/\s\/\/.*$/, "");
    for (const p of PATTERNS) if (p.re.test(code)) out.push({ file, line: i + 1, msg: p.msg });
  });
  return out;
}

/** Áp allowlist: mỗi file chỉ được tối đa `max` vi phạm đã biết; dư ra là lỗi. */
export function applyAllowlist(found: Finding[]): Finding[] {
  const bad: Finding[] = [];
  const byFile = new Map<string, Finding[]>();
  for (const f of found) byFile.set(f.file, [...(byFile.get(f.file) ?? []), f]);
  for (const [file, list] of byFile) {
    const allowed = ALLOWLIST.find((a) => a.file === file)?.max ?? 0;
    bad.push(...list.slice(allowed));
  }
  return bad;
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return walk(p);
    return n.endsWith(".ts") && !n.endsWith(".test.ts") ? [p] : [];
  });
}

export function checkContractName(root: string): Finding[] {
  const base = join(root, PACK_DIR);
  const found = walk(base).flatMap((p) => {
    const rel = relative(base, p).replaceAll("\\", "/");
    if (rel === DEFINITION) return [];
    const src = readFileSync(p, "utf8");
    return carriesSql(src) ? scanFile(rel, src) : [];
  });
  return applyAllowlist(found);
}

function main(): number {
  const bad = checkContractName(repoRoot());
  for (const f of bad) console.error(`contract-name: ${PACK_DIR}/${f.file}:${f.line} — ${f.msg}`);
  console.log(bad.length === 0 ? "contract-name: sạch" : `contract-name: ${bad.length} vi phạm`);
  return bad.length === 0 ? 0 : 1;
}

if (import.meta.main) process.exit(main());
