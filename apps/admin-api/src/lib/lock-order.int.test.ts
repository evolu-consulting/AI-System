// ADM-FR-63, ADM-FR-05, ADM-FR-02 · review vòng 2 N1: khoá hàng khi ghi user (FOR NO KEY UPDATE) không deadlock với
// INSERT refresh_tokens (FK lấy FOR KEY SHARE trên tenant/user). Hai transaction xen kẽ có chủ đích:
// A giữ khoá hàng user rồi mới chèn refresh token; B (lockUser/resetPassword) chen vào giữa.
// Deadlock thật thì Postgres chỉ phát hiện sau deadlock_timeout (1 s) rồi withScope chạy lại → kiểm cả thời gian
// lẫn bộ đếm deadlock của DB để chứng minh không có deadlock nào, không chỉ "không 500".
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { createDb, runMigrations, withScope } from "@ai/db";
import { resetTestDb } from "@ai/db/test-db";
import postgres from "postgres";
import * as authRepo from "../modules/auth/auth.repo";
import { type AuthCtx, issueSession } from "../modules/auth/auth.session";
import * as usersRepo from "../modules/users/users.repo";
import { type Call, createUser, lockUser, resetPassword } from "../modules/users/users.service";
import { loadJwtKeys } from "./jwt";

const OWNER = process.env.TEST_DATABASE_URL;
const API = process.env.TEST_ADMIN_API_DATABASE_URL;
if (!OWNER || !API) throw new Error("TEST_DATABASE_URL/TEST_ADMIN_API_DATABASE_URL chưa đặt");

const TID = "01900000-0000-7000-8000-0000000bb001";
const ADMIN = "01900000-0000-7000-8000-0000000bb011";
const MEM = "01900000-0000-7000-8000-0000000bb012";
const owner = postgres(OWNER, { max: 1, onnotice: () => {} });
const db = createDb(API, { max: 6 });
const scope = { kind: "tenant", tenantId: TID } as const;
const call: Call = {
  ctx: { db },
  actor: { userId: ADMIN, tenantId: TID, role: "tenant_admin" },
  scope,
};
const WEB = { client: "web" as const, userAgent: "lock-order" };
let ctx: AuthCtx;

const deadlocks = async () => {
  await owner`select pg_stat_clear_snapshot()`;
  const [r] = await owner`select deadlocks::int as n from pg_stat_database
    where datname = current_database()`;
  return Number(r?.n ?? 0);
};

/** A giữ khoá hàng user (như login/đổi mật khẩu), B chạy trong lúc đó, rồi A chèn refresh token. */
async function interleave(
  holdLock: (tx: Parameters<Parameters<typeof withScope>[2]>[0]) => Promise<void>,
  b: () => Promise<unknown>,
  finishA: (tx: Parameters<Parameters<typeof withScope>[2]>[0]) => Promise<unknown>,
) {
  const before = await deadlocks();
  const t0 = performance.now();
  let pb: Promise<unknown> = Promise.resolve();
  await withScope(db, scope, async (tx) => {
    await holdLock(tx);
    pb = b();
    await Bun.sleep(200); // B đã lấy khoá tenant và đang chờ hàng user/token của A
    await finishA(tx);
  });
  await pb;
  const ms = performance.now() - t0;
  await Bun.sleep(600); // thống kê deadlock được flush định kỳ
  return { ms, deadlocks: (await deadlocks()) - before };
}

beforeAll(async () => {
  await resetTestDb(OWNER);
  await runMigrations({ url: OWNER, appEnv: "test" });
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const keys = await loadJwtKeys({
    JWT_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    JWT_PUBLIC_KEY: publicKey.export({ type: "spki", format: "pem" }).toString(),
    JWT_KID: "lock",
  });
  ctx = { db, keys, now: () => new Date(), dummyHash: "x" };
});
beforeEach(async () => {
  await owner`truncate admin.refresh_tokens, admin.users, admin.tenants cascade`;
  await owner`insert into admin.tenants (id, key, name) values (${TID}, 'lock', 'Lock')`;
  await owner`insert into admin.users (id, tenant_id, username, email, password_hash, display_name, role, must_change_password)
    values (${ADMIN}, ${TID}, 'boss', 'boss@lock.test', 'h', 'Boss', 'tenant_admin', false),
           (${MEM}, ${TID}, 'mem', null, 'h', 'Mem', 'member', false)`;
});
afterAll(async () => {
  await db.close();
  await owner.end();
});

const memUser = async (tx: Parameters<Parameters<typeof withScope>[2]>[0]) => {
  const u = await authRepo.findUserById(tx, TID, MEM);
  if (!u) throw new Error("thiếu user");
  return u;
};

describe("ADM-FR-63 · review vòng 2 N1 · không deadlock với FK refresh_tokens", () => {
  test("ADM-FR-05 · login (giữ khoá user → issueSession) xen kẽ lockUser → cả hai xong, không deadlock", async () => {
    const r = await interleave(
      async (tx) => {
        await authRepo.lockCounter(tx, TID, MEM);
      },
      () => lockUser(call, MEM),
      async (tx) => issueSession(ctx, tx, await memUser(tx), WEB),
    );
    expect(r.deadlocks).toBe(0);
    expect(r.ms).toBeLessThan(900);
    const [u] = await owner`select active from admin.users where id = ${MEM}`;
    expect(u?.active).toBe(false);
    const rows = await owner`select revoked_reason from admin.refresh_tokens`;
    expect(rows.map((x) => x.revoked_reason)).toEqual(["user_locked"]);
  });

  test("ADM-FR-02 · refresh rotate (thu hồi token cũ → chèn token mới) xen kẽ resetPassword → không deadlock", async () => {
    const first = await withScope(db, scope, async (tx) =>
      issueSession(ctx, tx, await memUser(tx), WEB),
    );
    const [old] = await owner`select id, family_id, expires_at from admin.refresh_tokens`;
    const newId = Bun.randomUUIDv7();
    const r = await interleave(
      async (tx) => {
        await authRepo.lockUserShared(tx, TID, MEM); // như rotate() trong auth.service
        expect(await authRepo.rotateRefresh(tx, TID, old?.id, newId)).toBe(true);
      },
      () => resetPassword(call, MEM),
      async (tx) =>
        authRepo.insertRefresh(tx, {
          id: newId,
          userId: MEM,
          tenantId: TID,
          familyId: old?.family_id,
          tokenHash: Buffer.alloc(32, 7),
          client: "web",
          userAgent: null,
          expiresAt: new Date(old?.expires_at),
        }),
    );
    expect(first.refreshToken.length).toBeGreaterThan(0);
    expect(r.deadlocks).toBe(0);
    expect(r.ms).toBeLessThan(900);
    const rows =
      await owner`select revoked_reason from admin.refresh_tokens order by created_at, id`;
    expect(new Set(rows.map((x) => x.revoked_reason))).toEqual(
      new Set(["rotated", "password_reset"]),
    );
  });
});

describe("ADM-FR-63 · FOR NO KEY UPDATE vẫn tuần tự hoá", () => {
  test("ADM-FR-04 · khoá tenant (NO KEY UPDATE) chặn FOR SHARE của createUser tới khi commit", async () => {
    let created = 0;
    const t0 = performance.now();
    let pc: Promise<unknown> = Promise.resolve();
    await withScope(db, scope, async (tx) => {
      await usersRepo.findTenantBrief(tx, TID, { lock: "no key update" });
      pc = createUser(call, undefined, {
        username: "nam",
        display_name: "Nam",
        role: "member",
        locale: "vi",
      }).then(() => {
        created = performance.now() - t0;
      });
      await Bun.sleep(300);
      const [n] = await owner`select count(*)::int as n from admin.users where username = ${"nam"}`;
      expect(n?.n).toBe(0);
    });
    await pc;
    expect(created).toBeGreaterThanOrEqual(290);
  });

  test("ADM-BR-08 · hai lockUser cùng tenant nối tiếp nhau (NO KEY UPDATE xung đột với nhau)", async () => {
    await owner`update admin.users set role = 'tenant_admin', email = 'mem@lock.test' where id = ${MEM}`;
    const asMem: Call = { ...call, actor: { userId: MEM, tenantId: TID, role: "tenant_admin" } };
    const r = await Promise.allSettled([lockUser(call, MEM), lockUser(asMem, ADMIN)]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    const [c] =
      await owner`select count(*)::int as n from admin.users where active and role = 'tenant_admin'`;
    expect(c?.n).toBe(1);
  });
});
