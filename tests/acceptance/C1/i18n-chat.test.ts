// CHAT-AC-36 · packages/i18n/locales/chat/{vi,en}.json đồng bộ khoá, không rỗng, cùng biến {{x}} [U-10].
import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CHAT_WEB_ENABLED, ROOT } from "./_gate";

type Tree = { [k: string]: string | Tree };

function flatten(tree: Tree, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out[key] = v;
    else Object.assign(out, flatten(v, key));
  }
  return out;
}
const file = (lang: string): string => join(ROOT, `packages/i18n/locales/chat/${lang}.json`);
const load = (lang: string): Record<string, string> => {
  expect(existsSync(file(lang))).toBe(true);
  return flatten(JSON.parse(readFileSync(file(lang), "utf8")) as Tree);
};
const vars = (s: string): string =>
  [...s.matchAll(/\{\{\s*(\w+)\s*\}\}/g)]
    .map((m) => m[1] ?? "")
    .sort()
    .join(",");

const E2E_KEYS = ["login.invalid", "login.locked", "session.expired"];

describe.skipIf(!CHAT_WEB_ENABLED)("i18n-chat", () => {
  it("CHAT-AC-36 · có đủ hai file vi.json và en.json [U-10]", () => {
    expect(existsSync(file("vi"))).toBe(true);
    expect(existsSync(file("en"))).toBe(true);
  });
  it("CHAT-AC-36 · VI và EN cùng tập khoá [U-10]", () => {
    const vi = Object.keys(load("vi")).sort();
    const en = Object.keys(load("en")).sort();
    expect(vi.length).toBeGreaterThan(0);
    expect(en).toEqual(vi);
  });
  it("CHAT-AC-36 · không giá trị rỗng ở cả hai ngôn ngữ [U-10]", () => {
    for (const lang of ["vi", "en"]) {
      const empty = Object.entries(load(lang)).filter(([, v]) => v.trim() === "");
      expect(empty.map(([k]) => `${lang}:${k}`)).toEqual([]);
    }
  });
  it("CHAT-AC-36 · mỗi khoá có cùng tập biến {{x}} ở VI và EN [U-10]", () => {
    const vi = load("vi");
    const en = load("en");
    const diff = Object.keys(vi).filter((k) => vars(vi[k] ?? "") !== vars(en[k] ?? ""));
    expect(diff).toEqual([]);
  });
  it("CHAT-AC-36 · có các khoá e2e dùng (login.invalid, login.locked, session.expired) [U-10]", () => {
    expect(E2E_KEYS.filter((k) => !(k in load("vi")))).toEqual([]);
    expect(E2E_KEYS.filter((k) => !(k in load("en")))).toEqual([]);
  });
});
