// CR-121 phần B-2 · ADR-0037 · `bun tools/scripts/src/codemod-module-public.ts <module> [--dry]`
// Chuyển import xuyên module của hub-api sang cửa `modules/<module>/public.ts`: mọi import tương đối từ NGOÀI module vào
// file trong module (không phải `public.ts`/`testing/`) được đổi specifier thành `<…>/modules/<module>/public`.
// Điều kiện: `public.ts` đã export đủ tên (chạy typecheck sau đó; thiếu ⇒ thêm vào public.ts, không `export *`).
// Chạy lại được; module ví dụ: `config`, `packs/kit`. Sau đó `bunx biome check --write <file đổi>` (gộp import trùng) và
// `bun tools/scripts/src/check-boundaries.ts --write` để co baseline.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { joinRelative, relativeSpecifiers, SRC } from "./check-boundaries.rules";
import { git, repoRoot } from "./lib/git";

/** Đường tương đối từ thư mục của `fromFile` tới `target` (không đuôi), luôn có tiền tố `./` hoặc `../`. */
export function relativeTo(fromFile: string, target: string): string {
  const a = fromFile.split("/").slice(0, -1);
  const b = target.split("/");
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  const up = a.length - i;
  const rest = b.slice(i).join("/");
  return (up === 0 ? "./" : "../".repeat(up)) + rest;
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Đổi specifier trỏ vào module (từ ngoài) thành `public`; trả text mới (không đổi ⇒ cùng chuỗi). */
export function rewriteToPublic(fromFile: string, source: string, module: string): string {
  const prefix = `${SRC}modules/${module}/`;
  if (fromFile.startsWith(prefix)) return source;
  let text = source;
  for (const spec of relativeSpecifiers(source)) {
    const target = joinRelative(fromFile, spec);
    if (!target.startsWith(prefix)) continue;
    const inner = target.slice(prefix.length);
    if (inner === "public" || inner.startsWith("testing/")) continue;
    const pub = relativeTo(fromFile, `${prefix}public`);
    text = text.replace(new RegExp(`(["'])${escapeRe(spec)}\\1`, "g"), `$1${pub}$1`);
  }
  return text;
}

function main(argv: string[]): number {
  const module = argv.find((a) => !a.startsWith("--"));
  if (!module) {
    console.error("dùng: codemod-module-public.ts <module> [--dry]   (vd config, packs/kit)");
    return 1;
  }
  const dry = argv.includes("--dry");
  const root = repoRoot();
  const files = git(["ls-files", "--", `${SRC}*.ts`, `${SRC}*.tsx`], root)
    .out.split("\n")
    .map((l) => l.trim())
    .filter((f) => f && !/\.test\.tsx?$/.test(f)); // test được phép import ruột (luật ADR-0037)
  const changed: string[] = [];
  for (const f of files) {
    const src = readFileSync(join(root, f), "utf8");
    const next = rewriteToPublic(f, src, module);
    if (next === src) continue;
    changed.push(f);
    if (!dry) writeFileSync(join(root, f), next);
  }
  console.log(
    `codemod-module-public ${module}: ${dry ? "sẽ đổi" : "đã đổi"} ${changed.length} file`,
  );
  if (changed.length > 0) console.log(`CHANGED:\n${changed.join("\n")}`);
  return 0;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
