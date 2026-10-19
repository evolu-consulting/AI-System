// PK-FR-03 · N1 plan §4: kiểm đầu vào `withPackScope` TRƯỚC khi mở tx (không cần DB — tx giả ghi nhận lời gọi).
import { describe, expect, test } from "bun:test";
import type { Db } from "./client";
import { PackScopeError, packRole, withPackScope } from "./pack-scope";

const T = "a5e10000-0000-4000-8000-000000000001";
function fakeDb(): { db: Db; opened: () => number } {
  let n = 0;
  const db = {
    db: {
      transaction: async () => {
        n++;
        return 1;
      },
    },
  } as unknown as Db;
  return { db, opened: () => n };
}

describe("PK-FR-03 · withPackScope kiểm đầu vào", () => {
  test("packRole: khoá hợp lệ ⇒ `<k>_rw`; sai dạng / bị cấm ⇒ PACK_KEY_INVALID", () => {
    expect(packRole("pkdemo")).toBe("pkdemo_rw");
    for (const k of ["Bad", "public", "admin", "pg_x", "a", "x-y"])
      expect(() => packRole(k)).toThrow(PackScopeError);
  });
  test("tenant không phải uuid ⇒ TENANT_INVALID, không mở tx", async () => {
    const f = fakeDb();
    await expect(
      withPackScope(f.db, { packKey: "pkdemo", tenantId: "x", userId: null }, async () => 1),
    ).rejects.toThrow("TENANT_INVALID");
    expect(f.opened()).toBe(0);
  });
  test("user sai dạng ⇒ USER_INVALID; hợp lệ ⇒ mở đúng một tx", async () => {
    const f = fakeDb();
    await expect(
      withPackScope(f.db, { packKey: "pkdemo", tenantId: T, userId: "u" }, async () => 1),
    ).rejects.toThrow("USER_INVALID");
    await withPackScope(f.db, { packKey: "pkdemo", tenantId: T, userId: T }, async () => 1);
    expect(f.opened()).toBe(1);
  });
});
