// ADM-BR-08, ADM-BR-09, ADM-FR-05 · users.service trên DB thật qua role admin_api (plan M1 §8).
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createDb, runMigrations } from "@ai/db";
import { resetTestDb } from "@ai/db/test-db";
import postgres from "postgres";
import { isAppError } from "../../lib/errors";
import { type Call, getUser, lockUser, unlockUser, updateUser } from "./users.service";

const OWNER = process.env.TEST_DATABASE_URL;
const API = process.env.TEST_ADMIN_API_DATABASE_URL;
if (!OWNER || !API) throw new Error("TEST_DATABASE_URL/TEST_ADMIN_API_DATABASE_URL chưa đặt");

const ACME = "01900000-0000-7000-8000-00000000f001";
const GLOBEX = "01900000-0000-7000-8000-00000000f002";
const A1 = "01900000-0000-7000-8000-00000000f011";
const A2 = "01900000-0000-7000-8000-00000000f012";
const M1 = "01900000-0000-7000-8000-00000000f013";
const G1 = "01900000-0000-7000-8000-00000000f021";
const owner = postgres(OWNER, { max: 1, onnotice: () => {} });
const ctx = { db: createDb(API, { max: 6 }) };
const as = (userId: string): Call => ({
  ctx,
  actor: { userId, tenantId: ACME, role: "tenant_admin" },
  scope: { kind: "tenant", tenantId: ACME },
});
const code = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (e) => (isAppError(e) ? e.code : String(e)),
  );

beforeAll(async () => {
  await resetTestDb(OWNER);
  await runMigrations({ url: OWNER, appEnv: "test" });
});
beforeEach(async () => {
  await owner`truncate admin.refresh_tokens, admin.users, admin.tenants cascade`;
  await owner`insert into admin.tenants (id, key, name) values (${ACME}, 'acme', 'A'), (${GLOBEX}, 'globex', 'G')`;
  await owner`insert into admin.users (id, tenant_id, username, email, password_hash, display_name, role)
    values (${A1}, ${ACME}, 'a1', 'a1@x.test', 'h', 'A1', 'tenant_admin'),
           (${A2}, ${ACME}, 'a2', 'a2@x.test', 'h', 'A2', 'tenant_admin'),
           (${M1}, ${ACME}, 'm1', null, 'h', 'M1', 'member'),
           (${G1}, ${GLOBEX}, 'g1', 'g1@x.test', 'h', 'G1', 'tenant_admin')`;
});
afterAll(async () => {
  await ctx.db.close();
  await owner.end();
});

describe("ADM-BR-08 · song song", () => {
  test("ADM-BR-08 · a1 và a2 khoá nhau cùng lúc (5 vòng) → đúng 1 thành công, còn ≥ 1 admin active", async () => {
    for (let i = 0; i < 5; i++) {
      await owner`update admin.users set active = true, version = 1 where tenant_id = ${ACME}`;
      const r = await Promise.all([code(lockUser(as(A1), A2)), code(lockUser(as(A2), A1))]);
      expect(r.sort()).toEqual(["LAST_ADMIN", "ok"]);
      const [c] = await owner`select count(*)::int as n from admin.users
        where tenant_id = ${ACME} and role = 'tenant_admin' and active`;
      expect(c?.n).toBe(1);
    }
  });
});

describe("ADM-BR-09 · cách ly", () => {
  test("ADM-BR-09 · tenant_admin acme đọc/sửa/khoá user globex → NOT_FOUND", async () => {
    expect(await code(getUser(as(A1), G1))).toBe("NOT_FOUND");
    expect(await code(updateUser(as(A1), G1, { version: 1, display_name: "x" }))).toBe("NOT_FOUND");
    expect(await code(lockUser(as(A1), G1))).toBe("NOT_FOUND");
  });
});

describe("ADM-FR-05 · lock/unlock không đổi trạng thái → không tăng version", () => {
  test("ADM-FR-05 · lock 2 lần, unlock 2 lần: version 1 → 2 → 2 → 3 → 3; unlock xoá khoá tạm", async () => {
    await owner`update admin.users set failed_logins = 2, locked_until = now() + interval '5 minutes' where id = ${M1}`;
    const v = [];
    v.push((await lockUser(as(A1), M1)).version);
    v.push((await lockUser(as(A1), M1)).version);
    v.push((await unlockUser(as(A1), M1)).version);
    v.push((await unlockUser(as(A1), M1)).version);
    expect(v).toEqual([2, 2, 3, 3]);
    const [u] = await owner`select failed_logins, locked_until from admin.users where id = ${M1}`;
    expect(u).toEqual({ failed_logins: 0, locked_until: null });
  });
});
