// CR-125 c3 · đọc mọi file locale `packages/i18n/locales/**` thành danh sách (đường dẫn tương đối, khoá phẳng, giá trị) — dùng chung cho các check về chữ.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export const LOCALES_REL = "packages/i18n/locales";
export type LocaleEntry = { file: string; lang: "vi" | "en"; key: string; value: string };

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === "node_modules" ? [] : walk(p);
    return n.endsWith(".json") ? [p] : [];
  });
}

/** Ngôn ngữ của file: `vi.json`, `x.vi.json` ⇒ vi; `en.json`, `x.en.json` ⇒ en. */
export const langOf = (file: string): "vi" | "en" | null =>
  /(^|[./\\])vi\.json$/.test(file) ? "vi" : /(^|[./\\])en\.json$/.test(file) ? "en" : null;

export function flattenStrings(tree: unknown, prefix = ""): [string, string][] {
  if (typeof tree === "string") return [[prefix, tree]];
  if (!isObj(tree)) return [];
  return Object.entries(tree).flatMap(([k, v]) => flattenStrings(v, prefix ? `${prefix}.${k}` : k));
}

/** Khoá đầy đủ như runtime: root/chat/studio/community dùng khoá trong file; `process/<phần>.*` thêm tiền tố `process.<phần>.`. */
export function readLocaleEntries(root: string): LocaleEntry[] {
  const base = join(root, LOCALES_REL);
  return walk(base).flatMap((abs) => {
    const file = abs.slice(base.length + 1).replaceAll("\\", "/");
    const lang = langOf(file);
    if (!lang) return [];
    const part = /^process\/([^.]+)\./.exec(file)?.[1];
    const prefix = part ? `process.${part}` : "";
    const tree: unknown = JSON.parse(readFileSync(abs, "utf8"));
    return flattenStrings(tree, prefix).map(([key, value]) => ({ file, lang, key, value }));
  });
}
