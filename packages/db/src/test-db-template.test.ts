import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrationsHash, templateDbName, trashNames } from "./test-db-template";

describe("ADM-NFR-06 · tên template DB test", () => {
  test("ai_system_h1_test + key full → ai_system_h1_full_tpl_test", () => {
    expect(templateDbName("ai_system_h1_test", "full")).toBe("ai_system_h1_full_tpl_test");
  });

  test("tên dài → băm tên đích, vẫn ≤ 63 và hậu tố _test; khác đích → khác template", () => {
    const a = templateDbName(`ai_system_${"a".repeat(24)}_test`, "a".repeat(24));
    const b = templateDbName(`ai_system_${"b".repeat(24)}_test`, "a".repeat(24));
    expect(a.length).toBeLessThanOrEqual(63);
    expect(a.endsWith("_test")).toBe(true);
    expect(a).not.toBe(b);
  });

  test.each(["ai_system", "ai_system_test_x", "postgres"])(
    "đích %s không kết thúc _test → ném",
    (n) => {
      expect(() => templateDbName(n, "full")).toThrow(/_test/);
    },
  );

  test.each(["", "Full", "a-b", "a".repeat(25), "x;drop"])("key sai %j → ném", (k) => {
    expect(() => templateDbName("ai_system_test", k)).toThrow();
  });
});

describe("ADM-NFR-06 · tên DB rác", () => {
  test("rác ≤ 63, hậu tố _test, mỗi lần một tên", () => {
    const s = trashNames("ai_system_w0_h1_test");
    const [a, b] = [s.next(), s.next()];
    expect(a).not.toBe(b);
    for (const n of [a, b, trashNames(`ai_system_${"a".repeat(40)}_test`).next()]) {
      expect(n.length).toBeLessThanOrEqual(63);
      expect(n).toMatch(/_trash_[0-9a-z]+_test$/);
    }
  });

  test("mẫu LIKE gom rác chỉ trúng rác của đúng đích (không trúng đích có tiền tố dài hơn)", () => {
    const like = (p: string) =>
      new RegExp(`^${p.replace(/\\(.)|%|_/g, (m, e) => (e ? e : m === "%" ? ".*" : "."))}$`);
    const w0 = trashNames("ai_system_w0_test");
    expect(like(w0.like).test(w0.next())).toBe(true);
    expect(like(w0.like).test(trashNames("ai_system_w0_h1_test").next())).toBe(false);
    expect(like(w0.like).test("ai_system_w0_test")).toBe(false);
  });
});
describe("ADM-NFR-06 · hash migration của template", () => {
  const root = mkdtempSync(join(tmpdir(), "tpl-hash-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "migrations", "meta"), { recursive: true });
  mkdirSync(join(root, "migrations-hub"), { recursive: true });
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "migrations", "0000_a.sql"), "create table a();");
  writeFileSync(join(root, "migrations", "meta", "_journal.json"), "{}");
  writeFileSync(join(root, "migrations-hub", "0000_h.sql"), "create table h();");

  test("ổn định giữa hai lần gọi; không phụ thuộc thư mục ngoài migrations*", () => {
    const h = migrationsHash(root);
    writeFileSync(join(root, "src", "x.ts"), "export {}");
    expect(migrationsHash(root)).toBe(h);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  test("đổi nội dung, thêm file (cả thư mục con meta/) → hash đổi", () => {
    const h0 = migrationsHash(root);
    writeFileSync(join(root, "migrations", "meta", "_journal.json"), '{"v":1}');
    const h1 = migrationsHash(root);
    writeFileSync(join(root, "migrations-hub", "0001_h.sql"), "select 1;");
    const h2 = migrationsHash(root);
    expect(new Set([h0, h1, h2]).size).toBe(3);
  });
});
