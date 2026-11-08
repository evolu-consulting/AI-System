// CR-125 G1 · luật thuần của `bun run check:error-codes` (audit #12, check 7): mã lỗi MỘT nguồn.
// (1) Mỗi mã khai ở `packages/contracts` có đúng MỘT khoá i18n chuẩn (mỗi ngôn ngữ) và không có khoá `.err.<MÃ>` / `.apiError.<MÃ>` thứ hai
// ngoài các tiền tố riêng của ứng dụng đã khai (`SHARED`); (2) hub không chứa câu tiếng Việt cạnh mã đó — hub trả mã + biến, web dịch.
import type { LocaleEntry } from "./lib/locale-files";

export type CodeSet = { name: string; codes: readonly string[]; prefix: string };
export type Issue = { file: string; line?: number; msg: string };

/** Khoá ngoài khoá chuẩn nhưng được phép: trình sửa luồng của app khác dùng bộ khoá riêng của nó (admin-web). */
export const SHARED_PREFIXES: readonly string[] = [
  "process.admin.flow.err.", // admin-web · trình sửa luồng (client)
  "process.admin.flow.esign.err.", // admin-web · panel node Ký số (mã FLOW_NODE_CONFIG_INVALID, tập mã khác)
];

const LAST_TWO = /\.(err|apiError)\.([A-Z][A-Z0-9_]+)$/;

type Rows = readonly Pick<LocaleEntry, "file" | "lang" | "key">[];

/** Mỗi mã: đúng một khoá chuẩn mỗi ngôn ngữ. */
function canonicalIssues(s: CodeSet, rows: Rows): Issue[] {
  const out: Issue[] = [];
  for (const code of s.codes) {
    const canon = `${s.prefix}.${code}`;
    for (const lang of ["vi", "en"] as const) {
      const n = rows.filter((r) => r.lang === lang && r.key === canon).length;
      const file = `locales/*.${lang}.json`;
      if (n === 0) out.push({ file, msg: `${s.name}: thiếu khoá ${canon}` });
      if (n > 1) out.push({ file, msg: `${s.name}: khoá ${canon} khai ${n} lần` });
    }
  }
  return out;
}

/** Khoá `.err.<MÃ>` / `.apiError.<MÃ>` thứ hai ngoài khoá chuẩn và tiền tố riêng đã khai. */
function secondKeyIssues(s: CodeSet, rows: Rows, shared: readonly string[]): Issue[] {
  const owned = new Set(s.codes);
  const out: Issue[] = [];
  for (const r of rows) {
    const code = LAST_TWO.exec(r.key)?.[2] ?? "";
    if (!owned.has(code) || r.key === `${s.prefix}.${code}`) continue;
    if (shared.some((p) => r.key.startsWith(p))) continue;
    out.push({
      file: r.file,
      msg: `${s.name}: mã ${code} có khoá thứ hai ${r.key} — dùng ${s.prefix}.${code}`,
    });
  }
  return out;
}

export function keyIssues(
  sets: readonly CodeSet[],
  rows: Rows,
  shared: readonly string[] = SHARED_PREFIXES,
): Issue[] {
  return sets.flatMap((s) => [...canonicalIssues(s, rows), ...secondKeyIssues(s, rows, shared)]);
}
const VI = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;
const WINDOW = 5;
/** Bỏ chú thích: dòng `//`, `/* … *​/` cùng dòng, và dòng thân khối chú thích (`/**`, ` * …`). */
const stripComment = (l: string) =>
  /^\s*(\/\*|\*)/.test(l) ? "" : l.replace(/\/\*.*?\*\//g, "").replace(/(^|\s)\/\/.*$/, "$1");

/** Hub (không tính test): dòng có câu tiếng Việt trong ${WINDOW} dòng sau một chỗ nhắc mã ⇒ vi phạm. */
export function hubTextIssues(
  files: ReadonlyMap<string, string>,
  codes: readonly string[],
): Issue[] {
  const out: Issue[] = [];
  const mention = new RegExp(
    `(["'\`])(${codes.join("|")})(?:[:"'\`])|^\\s*(${codes.join("|")})\\s*[:(]`,
  );
  for (const [file, src] of files) {
    if (/\.test\.tsx?$/.test(file) || !file.startsWith("apps/hub-api/src/")) continue;
    const lines = src.split("\n");
    const seen = new Set<number>();
    lines.forEach((l, i) => {
      if (!mention.test(stripComment(l))) return;
      for (let j = i; j <= Math.min(lines.length - 1, i + WINDOW); j++) {
        const body = stripComment(lines[j] ?? "");
        if (!seen.has(j) && VI.test(body)) {
          seen.add(j);
          out.push({
            file,
            line: j + 1,
            msg: "câu tiếng Việt cạnh mã lỗi — Hub trả mã + biến, web dịch",
          });
        }
      }
    });
  }
  return out;
}
