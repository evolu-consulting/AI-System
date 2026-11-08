// CR-125 B1 · S1b · unit: cờ role → chặn khởi động; câu SQL nhận đúng danh sách schema.
import { describe, expect, test } from "bun:test";
import type { Db } from "@ai/db";
import { assertSafeDbRole, UNSAFE_ROLE_MESSAGE, unsafeRole } from "./db-guard";

const fakeDb = (row: { dangerous_role: boolean; owns: boolean } | undefined) =>
  ({ db: { execute: async () => (row ? [row] : []) } }) as unknown as Db;

describe("CR-125 S1b · hub-api db-guard", () => {
  test("unsafeRole: superuser/BYPASSRLS hoặc owner hoặc không có hàng ⇒ chặn", () => {
    expect(unsafeRole({ dangerous_role: false, owns: false })).toBe(false);
    expect(unsafeRole({ dangerous_role: true, owns: false })).toBe(true);
    expect(unsafeRole({ dangerous_role: false, owns: true })).toBe(true);
    expect(unsafeRole(undefined)).toBe(true);
  });

  test("assertSafeDbRole: role an toàn qua; owner ⇒ ném UNSAFE_ROLE_MESSAGE", async () => {
    await expect(
      assertSafeDbRole(fakeDb({ dangerous_role: false, owns: false })),
    ).resolves.toBeUndefined();
    await expect(assertSafeDbRole(fakeDb({ dangerous_role: false, owns: true }))).rejects.toThrow(
      UNSAFE_ROLE_MESSAGE,
    );
    await expect(
      assertSafeDbRole(fakeDb({ dangerous_role: true, owns: false }), []),
    ).rejects.toThrow(UNSAFE_ROLE_MESSAGE);
  });
});
