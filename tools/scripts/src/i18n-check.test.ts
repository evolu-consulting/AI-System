import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { diffKeys, flattenKeys } from "./i18n-check";

const SCRIPT = join(import.meta.dir, "i18n-check.ts");
const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

function run(locales: Partial<Record<"vi" | "en", string>>) {
  const dir = mkdtempSync(join(tmpdir(), "be-i18n-"));
  dirs.push(dir);
  Bun.spawnSync(["git", "init", "-q", "-b", "main"], { cwd: dir });
  const loc = join(dir, "packages/i18n/locales");
  mkdirSync(loc, { recursive: true });
  for (const [lang, text] of Object.entries(locales))
    writeFileSync(join(loc, `${lang}.json`), text);
  const p = Bun.spawnSync([process.execPath, SCRIPT], { cwd: dir, stdout: "pipe", stderr: "pipe" });
  return { code: p.exitCode, out: p.stdout.toString() + p.stderr.toString() };
}

describe("ADM-NFR-06 · i18n-check hàm thuần", () => {
  test("flattenKeys lồng 3 cấp; mảng là lá; object rỗng không có key", () => {
    expect(flattenKeys({ a: { b: { c: "x" } }, d: "y", e: ["1"], f: {} })).toEqual([
      "a.b.c",
      "d",
      "e",
    ]);
  });

  test("diffKeys báo key thiếu từng bên", () => {
    expect(diffKeys({ a: { b: "x" }, d: "y" }, { a: { c: "x" } })).toEqual({
      missingVi: ["a.c"],
      missingEn: ["a.b", "d"],
    });
  });
});

describe("ADM-NFR-06 · i18n-check CLI (T-I18N-1)", () => {
  test("0 file → bỏ qua exit 0; 1 file → exit 1 nêu file thiếu", () => {
    const none = run({});
    expect(none.code).toBe(0);
    expect(none.out).toContain("i18n:check: chưa có locale, bỏ qua");
    const onlyVi = run({ vi: '{"a":"x"}' });
    expect(onlyVi.code).toBe(1);
    expect(onlyVi.out).toContain("i18n:check: thiếu packages/i18n/locales/en.json");
  });

  test("2 file khớp → 0; lệch → MISSING_<lang>; JSON hỏng → exit 1", () => {
    expect(run({ vi: '{"a":{"b":"x"}}', en: '{"a":{"b":"y"}}' }).code).toBe(0);
    const bad = run({ vi: '{"a":"x","d":"y"}', en: '{"a":"x"}' });
    expect(bad.code).toBe(1);
    expect(bad.out).toContain("MISSING_en d");
    const broken = run({ vi: "{", en: "{}" });
    expect(broken.code).toBe(1);
    expect(broken.out).toContain("không phải JSON hợp lệ");
  });
});
