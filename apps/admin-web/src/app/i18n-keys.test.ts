// ADM-FR-01, ADM-FR-60, ADM-FR-10 · M1-R22, M2-R28 · mọi key i18n nhắc trong mã admin-web phải có ở cả vi.json và en.json.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import en from "../../../../packages/i18n/locales/en.json";
import vi from "../../../../packages/i18n/locales/vi.json";
import { ERROR_MESSAGE_KEYS } from "../lib/errors";

type Tree = { [k: string]: string | Tree };

function leaves(tree: Tree, prefix = ""): string[] {
  return Object.entries(tree).flatMap(([k, v]) =>
    typeof v === "string" ? [`${prefix}${k}`] : leaves(v, `${prefix}${k}.`),
  );
}

/** Key số nhiều `a.b_one` + `a.b_other` được tính là có key gốc `a.b` (dùng với `{count}`). */
function withPlurals(keys: Set<string>): Set<string> {
  for (const k of [...keys]) {
    if (k.endsWith("_one") && keys.has(`${k.slice(0, -4)}_other`)) keys.add(k.slice(0, -4));
  }
  return keys;
}

const viKeys = withPlurals(new Set(leaves(vi as Tree)));
const enKeys = withPlurals(new Set(leaves(en as Tree)));
const namespaces = new Set(Object.keys(vi));

const SRC = join(import.meta.dir, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "ui" ? [] : sourceFiles(p);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith(".gen.ts")
      ? [p]
      : [];
  });
}

const KEY_LITERAL = /["'`]([a-z][A-Za-z]*(?:\.[A-Za-z0-9]+)+)["'`]/g;

function usedKeys(): Map<string, string> {
  const used = new Map<string, string>();
  for (const file of sourceFiles(SRC)) {
    for (const m of readFileSync(file, "utf8").matchAll(KEY_LITERAL)) {
      const key = m[1] as string;
      if (namespaces.has(key.split(".")[0] as string)) used.set(key, file);
    }
  }
  return used;
}

describe("ADM-FR-60 · M1-R22 · key i18n dùng trong mã", () => {
  test("mọi key literal có trong vi.json và en.json", () => {
    const missing = [...usedKeys()]
      .filter(([key]) => !viKeys.has(key) || !enKeys.has(key))
      .map(([key, file]) => `${key} (${file.replace(SRC, "src")})`);
    expect(missing).toEqual([]);
  }, 30_000); // quét đồng bộ cả src: chạy riêng ~0,2 s, chạy chung `bun test` có lúc > 5 s

  test("mọi key của bảng mã lỗi có trong vi.json và en.json", () => {
    for (const key of ERROR_MESSAGE_KEYS) {
      expect(viKeys.has(key)).toBe(true);
      expect(enKeys.has(key)).toBe(true);
    }
  });
});
