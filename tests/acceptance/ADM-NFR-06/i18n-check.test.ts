// ADM-NFR-06 · M0-AC16 · i18n:check (T-I18N-1; test-plan §3.10)

import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { makeRepo, removeRepo, run, scriptPath } from "./_helpers";

const LOC = "packages/i18n/locales";
const SKIP_MSG = "i18n:check: chưa có locale, bỏ qua";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) removeRepo(dirs.pop() as string);
});

function check(files: Record<string, string>, emptyLocalesDir = false) {
  const dir = makeRepo({ "README.md": "x\n", ...files });
  dirs.push(dir);
  if (emptyLocalesDir) mkdirSync(join(dir, LOC), { recursive: true });
  return run(["bun", scriptPath("i18n-check.ts")], dir);
}

const locales = (vi: unknown, en: unknown) => ({
  [`${LOC}/vi.json`]: JSON.stringify(vi),
  [`${LOC}/en.json`]: JSON.stringify(en),
});

describe("ADM-NFR-06 · M0-AC16 · i18n:check (T-I18N-1)", () => {
  it("ADM-NFR-06 · M0-AC16 · không có thư mục locales → exit 0, chưa có locale, bỏ qua", () => {
    const r = check({});
    expect(r.code).toBe(0);
    expect(r.out).toContain(SKIP_MSG);
  });

  it("ADM-NFR-06 · M0-AC16 · thư mục locales rỗng → như chưa có locale", () => {
    const r = check({}, true);
    expect(r.code).toBe(0);
    expect(r.out).toContain(SKIP_MSG);
  });

  it("ADM-NFR-06 · M0-AC16 · chỉ có vi.json → exit 1, thiếu en.json", () => {
    const r = check({ [`${LOC}/vi.json`]: '{"a":"x"}' });
    expect(r.code).toBe(1);
    expect(r.out).toContain(`i18n:check: thiếu ${LOC}/en.json`);
    expect(r.out).not.toContain(SKIP_MSG);
  });

  it("ADM-NFR-06 · M0-AC16 · chỉ có en.json → exit 1, thiếu vi.json", () => {
    const r = check({ [`${LOC}/en.json`]: '{"a":"x"}' });
    expect(r.code).toBe(1);
    expect(r.out).toContain(`i18n:check: thiếu ${LOC}/vi.json`);
    expect(r.out).not.toContain(SKIP_MSG);
  });

  it("ADM-NFR-06 · M0-AC16 · hai locale cùng tập key (giá trị khác) → exit 0", () => {
    const r = check(locales({ a: { b: { c: "x" } }, d: "y" }, { a: { b: { c: "X" } }, d: "Y" }));
    expect(r.code).toBe(0);
    expect(r.out).not.toContain("MISSING_");
  });

  it("ADM-NFR-06 · M0-AC16 · en thiếu a.b.c → exit 1, MISSING_en a.b.c", () => {
    const r = check(locales({ a: { b: { c: "x" } }, d: "y" }, { d: "Y" }));
    expect(r.code).toBe(1);
    expect(r.out).toContain("MISSING_en a.b.c");
    expect(r.out).not.toContain("MISSING_vi");
  });

  it("ADM-NFR-06 · M0-AC16 · vi thiếu d → exit 1, MISSING_vi d", () => {
    const r = check(locales({ a: { b: { c: "x" } } }, { a: { b: { c: "X" } }, d: "Y" }));
    expect(r.code).toBe(1);
    expect(r.out).toContain("MISSING_vi d");
    expect(r.out).not.toContain("MISSING_en");
  });

  it("ADM-NFR-06 · M0-AC16 · lệch cả hai phía → in cả MISSING_vi và MISSING_en", () => {
    const r = check(locales({ a: { b: { c: "x" } } }, { d: "Y" }));
    expect(r.code).toBe(1);
    expect(r.out).toContain("MISSING_vi d");
    expect(r.out).toContain("MISSING_en a.b.c");
  });

  it("ADM-NFR-06 · M0-AC16 · so theo key phẳng: a.b ≠ a.c", () => {
    const r = check(locales({ a: { b: "x" } }, { a: { c: "x" } }));
    expect(r.code).toBe(1);
    expect(r.out).toContain("MISSING_en a.b");
    expect(r.out).toContain("MISSING_vi a.c");
  });
});
