// CR-125 c3 · `bun run check:i18n-terms`: GIÁ TRỊ locale vi không chứa biến thể cấm trong `packages/i18n/glossary.vi.json`
// (từ chuẩn → biến thể cấm). Quét giá trị, không quét khoá. Ngoại lệ = thu hẹp `scope`, không bỏ dòng.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "./lib/git";
import { type LocaleEntry, readLocaleEntries } from "./lib/locale-files";

export const GLOSSARY_REL = "packages/i18n/glossary.vi.json";
export type GlossaryTerm = {
  prefer: string;
  forbid: string[];
  flags?: string;
  scope?: { include?: string[]; exclude?: string[] };
  note?: string;
};
export type Violation = { file: string; key: string; prefer: string; match: string; value: string };

const inScope = (file: string, s: GlossaryTerm["scope"]): boolean =>
  (!s?.include || s.include.some((p) => file.startsWith(p))) &&
  !(s?.exclude ?? []).some((p) => file.startsWith(p));

/** Hàm thuần: danh sách mục locale + bảng thuật ngữ ⇒ vi phạm (chỉ file vi). */
export function findTermViolations(entries: LocaleEntry[], terms: GlossaryTerm[]): Violation[] {
  const out: Violation[] = [];
  for (const t of terms) {
    const res = t.forbid.map((p) => new RegExp(p, t.flags ?? ""));
    for (const e of entries) {
      if (e.lang !== "vi" || !inScope(e.file, t.scope)) continue;
      for (const re of res) {
        const m = re.exec(e.value.replace(/\{\{?[\w:]+\}?\}/g, ""));
        if (m)
          out.push({ file: e.file, key: e.key, prefer: t.prefer, match: m[0], value: e.value });
      }
    }
  }
  return out;
}

export function loadGlossary(root: string): GlossaryTerm[] {
  return (JSON.parse(readFileSync(join(root, GLOSSARY_REL), "utf8")) as { terms: GlossaryTerm[] })
    .terms;
}

function main(): number {
  const root = repoRoot();
  const bad = findTermViolations(readLocaleEntries(root), loadGlossary(root));
  for (const v of bad)
    console.error(`i18n-terms: ${v.file} ${v.key} — "${v.match}" → dùng "${v.prefer}"`);
  console.log(bad.length === 0 ? "i18n-terms: sạch" : `i18n-terms: ${bad.length} vi phạm`);
  return bad.length === 0 ? 0 : 1;
}

if (import.meta.main) process.exit(main());
