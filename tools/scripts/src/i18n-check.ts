// ADM-NFR-06 · `bun run i18n:check`: hai locale vi/en (Admin và chat/) phải cùng tập key phẳng (spec M0 T-I18N-1).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "./lib/git";

const LOCALES_DIR = "packages/i18n/locales";
const CHAT_DIR = "packages/i18n/locales/chat";
const LANGS = ["vi", "en"] as const;
type Lang = (typeof LANGS)[number];

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Key phẳng `a.b.c` của mọi lá (lá = giá trị không phải object). */
export function flattenKeys(obj: unknown, prefix = ""): string[] {
  if (!isObject(obj)) return prefix ? [prefix] : [];
  return Object.entries(obj).flatMap(([k, v]) => flattenKeys(v, prefix ? `${prefix}.${k}` : k));
}

/** Key có ở bên này mà thiếu ở bên kia, đã sắp xếp. */
export function diffKeys(vi: unknown, en: unknown): { missingVi: string[]; missingEn: string[] } {
  const a = new Set(flattenKeys(vi));
  const b = new Set(flattenKeys(en));
  return {
    missingVi: [...b].filter((k) => !a.has(k)).sort(),
    missingEn: [...a].filter((k) => !b.has(k)).sort(),
  };
}

function readLocale(root: string, dir: string, lang: Lang): unknown {
  const path = `${dir}/${lang}.json`;
  try {
    return JSON.parse(readFileSync(join(root, path), "utf8"));
  } catch (err) {
    throw new Error(`i18n:check: ${path} không phải JSON hợp lệ (${(err as Error).message})`);
  }
}

/** Kiểm một cặp vi/en trong `dir`: 0 = ổn hoặc chưa có file nào, 1 = lỗi. */
function checkPair(root: string, dir: string): number {
  const present = LANGS.filter((l) => existsSync(join(root, dir, `${l}.json`)));
  if (present.length === 0) {
    console.log(
      dir === LOCALES_DIR
        ? "i18n:check: chưa có locale, bỏ qua"
        : "i18n:check: chưa có locale chat, bỏ qua",
    );
    return 0;
  }
  const absent = LANGS.filter((l) => !present.includes(l));
  if (absent.length) {
    for (const l of absent) console.error(`i18n:check: thiếu ${dir}/${l}.json`);
    return 1;
  }
  let vi: unknown;
  let en: unknown;
  try {
    vi = readLocale(root, dir, "vi");
    en = readLocale(root, dir, "en");
  } catch (err) {
    console.error((err as Error).message);
    return 1;
  }
  const { missingVi, missingEn } = diffKeys(vi, en);
  for (const k of missingVi) console.error(`MISSING_vi ${dir === LOCALES_DIR ? "" : "chat:"}${k}`);
  for (const k of missingEn) console.error(`MISSING_en ${dir === LOCALES_DIR ? "" : "chat:"}${k}`);
  if (missingVi.length || missingEn.length) return 1;
  console.log(`i18n:check OK ${dir} (${flattenKeys(vi).length} key)`);
  return 0;
}

function main(): number {
  const root = repoRoot();
  // Gộp để cả hai cặp đều được báo, không dừng ở cặp đầu.
  return [LOCALES_DIR, CHAT_DIR].map((d) => checkPair(root, d)).some((c) => c !== 0) ? 1 : 0;
}

if (import.meta.main) process.exit(main());
