// COM-FR-46 · luật: không viết thẳng chuỗi tiếng Việt (có dấu) trong mã UI community-web — dùng `t("community.…")`.
// Quét src/ui, src/lib, src/main.tsx (bỏ test, chú thích). Ngoại lệ: dòng có `i18n-ignore`, hoặc file dữ liệu demo/mock bên dưới.
import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = join(import.meta.dir, "..");
/** Dữ liệu mock/regex dò nội dung — không phải chữ giao diện. */
const ALLOW = new Set(["domain/mask.ts", "domain/demo-products.ts", "domain/filters.ts"]);
const VI = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i;

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

/** Bỏ chú thích khối (giữ số dòng) và chú thích cuối dòng; dòng có `i18n-ignore` bỏ hẳn. */
export function codeLines(src: string): { n: number; text: string }[] {
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ""));
  return noBlock
    .split("\n")
    .map((raw, i) => ({ n: i + 1, raw }))
    .filter(({ raw }) => !raw.includes("i18n-ignore"))
    .map(({ n, raw }) => ({ n, text: raw.replace(/(^|\s)\/\/.*$/, "") }));
}

test("codeLines: bỏ chú thích và dòng i18n-ignore", () => {
  const out = codeLines(
    "const a = 'à'; // đ\n/* ư\nơ */ const b = 1;\nconst c = 'ê'; // i18n-ignore",
  );
  expect(out.filter((l) => VI.test(l.text)).map((l) => l.n)).toEqual([1]);
});

test("không có chuỗi tiếng Việt viết thẳng trong mã UI/lib (trừ test)", () => {
  const files = walk(SRC).filter((p) => {
    const rel = relative(SRC, p).replaceAll("\\", "/");
    return (
      /\.tsx?$/.test(rel) &&
      !/\.test\.tsx?$/.test(rel) &&
      /^(ui|domain|application)\//.test(rel) &&
      !ALLOW.has(rel)
    );
  });
  const bad: string[] = [];
  for (const f of files) {
    for (const l of codeLines(readFileSync(f, "utf8"))) {
      if (VI.test(l.text)) bad.push(`${relative(SRC, f)}:${l.n}: ${l.text.trim()}`);
    }
  }
  expect(bad).toEqual([]);
});
