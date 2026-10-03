// ADM-FR-63, ADM-FR-05, ADM-FR-02, ADM-FR-20, ADM-FR-30 · review vòng 2 N1 + M2 plan §5.1/§6 (G8): khoá hàng khi ghi user (FOR NO KEY UPDATE) không deadlock với
// INSERT refresh_tokens (FK lấy FOR KEY SHARE trên tenant/user). Hai transaction xen kẽ có chủ đích:
// A giữ khoá hàng user rồi mới chèn refresh token; B (lockUser/resetPassword) chen vào giữa.
// Deadlock thật thì Postgres chỉ phát hiện sau deadlock_timeout (1 s) rồi withScope chạy lại → kiểm cả thời gian
// lẫn bộ đếm deadlock của DB để chứng minh không có deadlock nào, không chỉ "không 500".
import { afterAll, beforeAll, beforeEach, describe, expect, it, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { createDb, runMigrations, withScope } from "@ai/db";
import { resetTestDb } from "@ai/db/test-db";
import postgres from "postgres";
import * as authRepo from "../modules/auth/auth.repo";
import { type AuthCtx, issueSession } from "../modules/auth/auth.session";
import { createCommand, updateCommand } from "../modules/commands/commands.service";
import { revokeEntitlement } from "../modules/features/features.entitlements";
import { deleteFeature, updateFeature } from "../modules/features/features.service";
import { batchGrants } from "../modules/grants/grants.batch";
import { createGrant } from "../modules/grants/grants.service";
import { addMembers } from "../modules/groups/groups.members";
import { deleteGroup, updateGroup } from "../modules/groups/groups.service";
import { createTenant } from "../modules/tenants/tenants.service";
import * as usersRepo from "../modules/users/users.repo";
import { type Call, createUser, lockUser, resetPassword } from "../modules/users/users.service";
import { updateWorkflow } from "../modules/workflows/workflows.service";
import { loadJwtKeys } from "./jwt";
import { barrier, codeOf, lockKit } from "./lock-order.helpers";
import type { TestHooks } from "./test-hooks";

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
const { deadlocks, deadlocksSince, interleave: m2Interleave, passBy } = lockKit(owner);

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
  return { ms, deadlocks: await deadlocksSince(before) };
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

// ---- M2 (plan §5.1, §6, G8): ba ca xen kẽ TẤT ĐỊNH bằng testHooks.afterLock ----

const PADM = "01900000-0000-7000-8000-0000000bb021";
const SEC = "01900000-0000-7000-8000-0000000bb031";
const WF = "01900000-0000-7000-8000-0000000bb041";
const FEAT_F = "01900000-0000-7000-8000-0000000bb051";
const FEAT_G = "01900000-0000-7000-8000-0000000bb052";
const CORE = "01900000-0000-7000-8000-0000000bb053";
const CMD = "01900000-0000-7000-8000-0000000bb061";
const platform = { kind: "platform" } as const;
const actor = {
  userId: PADM,
  tenantId: TID,
  tenantKey: "lock",
  role: "platform_admin",
  sid: null,
} as const;
const m2 = (hooks?: TestHooks) => ({ ctx: { db, hooks }, actor, scope: platform });

const featureCount = async (): Promise<number> => {
  const [r] =
    await owner`select count(*)::int as n from admin.feature_commands where command_id = ${CMD}`;
  return Number(r?.n ?? 0);
};

describe("ADM-BR-10 · M2 plan §5.1 · khoá hàng catalog xen kẽ tất định (G8)", () => {
  beforeEach(async () => {
    await owner`insert into admin.users (id, tenant_id, username, password_hash, display_name, role)
      values (${PADM}, ${TID}, 'padm', 'h', 'P', 'member')`;
    await owner`insert into admin.secrets (id, name, ciphertext, iv, last4)
      values (${SEC}, 'LOCK_KEY', ${Buffer.alloc(32)}, ${Buffer.alloc(12)}, 'abcd')`;
    await owner`insert into admin.workflows (id, key, name, description, app_type, base_url, secret_id)
      values (${WF}, 'lock-wf', 'W', ${"d".repeat(20)}, 'chat', 'https://x.test', ${SEC})`;
    await owner`insert into admin.features (id, key, name) values
      (${CORE}, 'core', '{"vi":"Cơ bản"}'::jsonb), (${FEAT_F}, 'f-one', '{"vi":"F"}'::jsonb),
      (${FEAT_G}, 'g-two', '{"vi":"G"}'::jsonb)`;
    await owner`insert into admin.commands (id, name, description, workflow_id, output)
      values (${CMD}, 'lock-cmd', '{"vi":"x"}'::jsonb, ${WF}, '{"field":"t","render":"text"}'::jsonb)`;
    await owner`insert into admin.command_names (name, command_id) values ('lock-cmd', ${CMD})`;
    await owner`insert into admin.feature_commands (feature_id, command_id)
      values (${FEAT_F}, ${CMD}), (${FEAT_G}, ${CMD})`;
  });

  test("ADM-BR-10 · (a) command PATCH bỏ G (dừng sau khoá) ∥ feature G PATCH bỏ cùng command (phải chờ) → đúng một thành công, command còn ≥ 1 feature", async () => {
    const b = barrier("command.save");
    const r = await m2Interleave(
      () => updateCommand(m2(b.hooks), CMD, { version: 1, feature_ids: [FEAT_F] }),
      () => updateFeature(m2(), FEAT_G, { version: 1, command_ids: [] }),
      b,
    );
    expect([r.ra.ok, r.rb.ok]).toEqual([true, false]);
    expect(["VERSION_CONFLICT", "COMMAND_NEEDS_FEATURE"]).toContain(codeOf(r.rb) ?? "");
    expect(await featureCount()).toBe(1);
    expect(r.deadlocks).toBe(0);
    expect(r.ms).toBeLessThan(900);
  });

  test("ADM-BR-02 · (b) command POST enabled=true (dừng sau SHARE workflow) ∥ workflow PATCH enabled=false (phải chờ) → POST thành công, workflow nhận WORKFLOW_IN_USE", async () => {
    const b = barrier("command.save");
    const r = await m2Interleave(
      () =>
        createCommand(m2(b.hooks), {
          name: "lock-new",
          aliases: [],
          description: { vi: "Mới" },
          workflow_id: WF,
          args: [],
          input_map: {},
          output: { field: "t", render: "text" },
          mode: "sync",
          enabled: true,
          feature_ids: [FEAT_F],
        }),
      () => updateWorkflow(m2(), WF, { version: 1, enabled: false }),
      b,
    );
    expect(r.ra.ok).toBe(true);
    expect(codeOf(r.rb)).toBe("WORKFLOW_IN_USE");
    const [bad] = await owner`select count(*)::int as n from admin.commands c
      join admin.workflows w on w.id = c.workflow_id where c.enabled and not w.enabled`;
    expect(bad?.n).toBe(0);
    expect(r.deadlocks).toBe(0);
    expect(r.ms).toBeLessThan(900);
  });

  test("ADM-BR-10 · (c) feature G DELETE (dừng sau khoá) ∥ command PATCH chỉ còn G (phải chờ) → xoá thành công, command nhận INVALID_REFERENCE, không mồ côi", async () => {
    const b = barrier("feature.delete");
    const r = await m2Interleave(
      () => deleteFeature(m2(b.hooks), FEAT_G),
      () => updateCommand(m2(), CMD, { version: 1, feature_ids: [FEAT_G] }),
      b,
    );
    expect(r.ra.ok).toBe(true);
    expect(codeOf(r.rb)).toBe("INVALID_REFERENCE");
    expect(await featureCount()).toBe(1);
    expect(r.deadlocks).toBe(0);
    expect(r.ms).toBeLessThan(900);
  });

  test('ADM-BR-01 · (d) PATCH đổi tên → "x" + feature_ids [F] (dừng sau khi ghi command_names) ∥ POST "x" với F → không deadlock (thứ tự khoá tên → features ở cả hai)', async () => {
    await owner`delete from admin.feature_commands where command_id = ${CMD} and feature_id = ${FEAT_F}`;
    const b = barrier("command.save", "names");
    const r = await m2Interleave(
      () => updateCommand(m2(b.hooks), CMD, { version: 1, name: "x-race", feature_ids: [FEAT_F] }),
      () =>
        createCommand(m2(), {
          name: "x-race",
          aliases: [],
          description: { vi: "Đua tên" },
          workflow_id: WF,
          args: [],
          input_map: {},
          output: { field: "t", render: "text" },
          mode: "sync",
          enabled: true,
          feature_ids: [FEAT_F],
        }),
      b,
    );
    expect(r.ra.ok).toBe(true);
    expect(codeOf(r.rb)).toBe("COMMAND_NAME_TAKEN");
    expect(r.deadlocks).toBe(0);
    expect(r.ms).toBeLessThan(900);
  });
});

// ---- M3 (plan §6.3): L1–L10 xen kẽ TẤT ĐỊNH qua khoá ngầm (FK KEY SHARE, unique index) + config_meta là khoá CUỐI ----

const n3 = (k: number) => `01900000-0000-7000-8000-0000000cc${String(k).padStart(3, "0")}`;
const [T2, U1, U2, G1, G2, G3, F1, F2] = [n3(1), n3(2), n3(3), n3(4), n3(5), n3(6), n3(7), n3(8)];
const who = (role: "tenant_admin" | "platform_admin") =>
  ({ userId: ADMIN, tenantId: TID, tenantKey: "lock", role, sid: null }) as const;
const ta = (hooks?: TestHooks) => ({ ctx: { db, hooks }, actor: who("tenant_admin"), scope });
const pa = (hooks?: TestHooks) => ({
  ctx: { db, hooks },
  actor: who("platform_admin"),
  scope: { kind: "platform" } as const,
});
const P = (feature_id: string, group_id: string) => ({ feature_id, group_id });
const cfgNow = async () =>
  Number((await owner`select config_version as v from admin.config_meta`)[0]?.v);
const grantRows = async (g: string) =>
  Number(
    (await owner`select count(*)::int as n from admin.feature_grants where group_id = ${g}`)[0]?.n,
  );
const ok = (r: { deadlocks: number; ms?: number }) => {
  expect(r.deadlocks).toBe(0);
  if (r.ms !== undefined) expect(r.ms).toBeLessThan(900);
};

async function seedM3(): Promise<void> {
  await owner`insert into admin.tenants (id, key, name) values (${T2}, 'lock2', 'Lock 2')`;
  await owner`insert into admin.users (id, tenant_id, username, password_hash, display_name, role) values
    (${U1}, ${TID}, 'u-one', 'h', 'U1', 'member'), (${U2}, ${TID}, 'u-two', 'h', 'U2', 'member')`;
  await owner`insert into admin.groups (id, tenant_id, key, name) values (${G1}, ${TID}, 'g-one', '{"vi":"G1"}'),
    (${G2}, ${TID}, 'g-two', '{"vi":"G2"}'), (${G3}, ${T2}, 'g-three', '{"vi":"G3"}')`;
  await owner`insert into admin.features (id, key, name) values (${F1}, 'f-one', '{"vi":"F1"}'),
    (${F2}, 'f-two', '{"vi":"F2"}')`;
  await owner`insert into admin.feature_entitlements (feature_id, tenant_id) values
    (${F1}, ${TID}), (${F2}, ${TID}), (${F1}, ${T2})`;
}

describe("ADM-FR-35 · M3 plan §6.3 · grant/batch qua khoá ngầm (L1–L2)", () => {
  beforeEach(seedM3);

  it("L1 · batch [bớt X, thêm Y] ∥ batch [thêm X, bớt Y] → cả hai xong, không deadlock", async () => {
    await batchGrants(ta(), undefined, { add: [P(F1, G1)], remove: [] });
    const v0 = await cfgNow();
    const b = barrier("grant.batch", "rows");
    const r = await m2Interleave(
      () => batchGrants(ta(b.hooks), undefined, { add: [P(F2, G2)], remove: [P(F1, G1)] }),
      () => batchGrants(ta(), undefined, { add: [P(F1, G1)], remove: [P(F2, G2)] }),
      b,
    );
    expect([r.ra.ok, r.rb.ok]).toEqual([true, true]);
    expect([await grantRows(G1), await grantRows(G2)]).toEqual([1, 0]);
    expect(await cfgNow()).toBe(v0 + 2);
    ok(r);
  });

  it("L2 · POST grant (f,g) ∥ POST cùng cặp (unique index) → 1 hàng, bump đúng một lần", async () => {
    const v0 = await cfgNow();
    const b = barrier("grant.save", "rows");
    const body = { feature_id: F1, group_id: G1 };
    const r = await m2Interleave(
      () => createGrant(ta(b.hooks), undefined, body),
      () => createGrant(ta(), undefined, body),
      b,
    );
    const created = [r.ra, r.rb].map((x) => (x.v as { created: boolean }).created);
    expect(created).toEqual([true, false]);
    expect([await grantRows(G1), await cfgNow()]).toEqual([1, v0 + 1]);
    ok(r);
  });
});

describe("ADM-FR-32 · M3 plan §6.3 · grant ∥ thu hồi entitlement (L3)", () => {
  beforeEach(seedM3);

  it("L3 · L3a grant giữ entitlement SHARE ∥ thu hồi chờ; L3b thu hồi giữ hàng ∥ grant → NOT_ENTITLED", async () => {
    const a = barrier("grant.save");
    const r1 = await m2Interleave(
      () => createGrant(ta(a.hooks), undefined, { feature_id: F1, group_id: G1 }),
      () => revokeEntitlement(pa(), F1, TID),
      a,
    );
    expect([r1.ra.ok, r1.rb.ok, await grantRows(G1)]).toEqual([true, true, 1]);
    ok(r1);
    const b = barrier("entitlement.save", "rows");
    const r2 = await m2Interleave(
      () => revokeEntitlement(pa(b.hooks), F2, TID),
      () => createGrant(ta(), undefined, { feature_id: F2, group_id: G2 }),
      b,
    );
    expect([r2.ra.ok, codeOf(r2.rb)]).toEqual([true, "NOT_ENTITLED"]);
    ok(r2);
  });
});

describe("ADM-FR-62 · M3 plan §6.3 · group/feature xoá ∥ batch (L4–L6)", () => {
  beforeEach(seedM3);

  it("L4 · L4a xoá group giữ NKU ∥ batch chờ → group_ids; L4b batch giữ hàng ∥ xoá group → cascade", async () => {
    const a = barrier("group.delete");
    const r1 = await m2Interleave(
      () => deleteGroup(ta(a.hooks), G1),
      () => batchGrants(ta(), undefined, { add: [P(F1, G1)], remove: [] }),
      a,
    );
    expect([r1.ra.ok, codeOf(r1.rb), await grantRows(G1)]).toEqual([true, "INVALID_REFERENCE", 0]);
    ok(r1);
    const b = barrier("grant.batch", "rows");
    const r2 = await m2Interleave(
      () => batchGrants(ta(b.hooks), undefined, { add: [P(F1, G2)], remove: [] }),
      () => deleteGroup(ta(), G2),
      b,
    );
    expect([r2.ra.ok, r2.rb.ok, await grantRows(G2)]).toEqual([true, true, 0]);
    ok(r2);
  });

  it("L5 · PATCH feature (NKU) ∥ POST grant feature đó (chờ SHARE) → cả hai xong, bump +2", async () => {
    const v0 = await cfgNow();
    const b = barrier("feature.save");
    const r = await m2Interleave(
      () => updateFeature(pa(b.hooks), F1, { version: 1, status: "beta" }),
      () => createGrant(ta(), undefined, { feature_id: F1, group_id: G1 }),
      b,
    );
    expect([r.ra.ok, r.rb.ok, await cfgNow()]).toEqual([true, true, v0 + 2]);
    ok(r);
  });

  it("L6 · xoá feature (NKU) ∥ batch thêm feature đó → INVALID_REFERENCE feature_ids", async () => {
    const b = barrier("feature.delete");
    const r = await m2Interleave(
      () => deleteFeature(pa(b.hooks), F2),
      () => batchGrants(ta(), undefined, { add: [P(F2, G1)], remove: [] }),
      b,
    );
    expect([r.ra.ok, codeOf(r.rb)]).toEqual([true, "INVALID_REFERENCE"]);
    expect((r.rb.e as { details?: { field?: string } }).details?.field).toBe("feature_ids");
    ok(r);
  });
});

const firstAdmin = (key: string) => ({
  key,
  name: key,
  max_concurrent_sub: null,
  first_admin: {
    username: "boss",
    display_name: "Boss",
    email: `boss@${key}.test`,
    locale: "vi" as const,
  },
});

describe("ADM-FR-53 · M3 plan §6.3 · config_meta cuối, tạo tenant (L7–L8)", () => {
  beforeEach(seedM3);

  it("L7 · A dừng NGAY TRƯỚC bump ∥ B tenant khác ghi xong không chờ → v_B = v0+1, v_A = v0+2", async () => {
    const v0 = await cfgNow();
    const b = barrier("group.save", "bump");
    const t2 = {
      ...ta(),
      actor: { ...who("tenant_admin"), tenantId: T2 },
      scope: { kind: "tenant", tenantId: T2 } as const,
    };
    const r = await passBy(
      () => updateGroup(ta(b.hooks), G1, { version: 1, name: { vi: "G1 mới" } }),
      async () => [
        await createGrant(t2, undefined, { feature_id: F1, group_id: G3 }),
        await cfgNow(),
      ],
      b,
    );
    expect([r.ra.ok, r.rb.ok]).toEqual([true, true]);
    expect((r.rb.v as unknown[])[1]).toBe(v0 + 1);
    expect(await cfgNow()).toBe(v0 + 2);
    ok(r);
  });

  it("L8 · POST tenant ∥ POST cùng key (unique tenants_key_uq) → KEY_TAKEN, đúng 1 beta-testers", async () => {
    const v0 = await cfgNow();
    const b = barrier("tenant.save", "rows");
    const ctx = { db, hooks: b.hooks };
    const platform = { kind: "platform" } as const;
    const r = await m2Interleave(
      () => createTenant({ ctx, scope: platform, actor: { userId: U1 } }, firstAdmin("acme2")),
      () =>
        createTenant({ ctx: { db }, scope: platform, actor: { userId: U1 } }, firstAdmin("acme2")),
      b,
    );
    expect([r.ra.ok, codeOf(r.rb)]).toEqual([true, "KEY_TAKEN"]);
    const [n] =
      await owner`select count(*)::int as n from admin.groups g join admin.tenants t on t.id = g.tenant_id
      where t.key = 'acme2' and g.key = 'beta-testers'`;
    expect([n?.n, await cfgNow()]).toEqual([1, v0 + 1]);
    ok(r);
  });
});

describe("ADM-FR-62 · M3 plan §6.3 · thành viên đua, retry 40P01 (L9–L10)", () => {
  beforeEach(seedM3);

  it("L9 · thêm thành viên [u2,u1] ∥ [u1,u2] → không deadlock; A added 2, B already 2, bump +1", async () => {
    const v0 = await cfgNow();
    const b = barrier("group.members", "rows");
    const r = await m2Interleave(
      () => addMembers(ta(b.hooks), G1, { usernames: ["u-two", "u-one"], dry_run: false }),
      () => addMembers(ta(), G1, { usernames: ["u-one", "u-two"], dry_run: false }),
      b,
    );
    const out = [r.ra, r.rb].map((x) => x.v as { added: string[]; already: string[] });
    expect([out[0]?.added.length, out[1]?.already.length, await cfgNow()]).toEqual([2, 2, v0 + 1]);
    ok(r);
  });

  it("L10 · 40P01 ở bump lần đầu → chạy lại: version +1, bump +1, đúng MỘT NOTIFY (sentinel)", async () => {
    const lis = postgres(OWNER, { max: 1, onnotice: () => {} });
    const got: { v: number; entity: string }[] = [];
    await lis.listen("config_changed", (raw) => got.push(JSON.parse(raw)));
    try {
      let n = 0;
      const hooks: TestHooks = {
        afterLock: (op, step) => {
          if (op !== "group.save" || step !== "bump" || n++ > 0) return;
          throw Object.assign(new Error("test deadlock"), { code: "40P01" });
        },
      };
      const v0 = await cfgNow();
      const g = await updateGroup(ta(hooks), G1, { version: 1, name: { vi: "G1 retry" } });
      await updateGroup(ta(), G2, { version: 1, name: { vi: "sentinel" } });
      const end = Date.now() + 1000;
      while (!got.some((m) => m.v === v0 + 2) && Date.now() < end) await Bun.sleep(10);
      expect([n, g.version, await cfgNow()]).toEqual([2, 2, v0 + 2]);
      expect(got.map((m) => m.v)).toEqual([v0 + 1, v0 + 2]);
    } finally {
      await lis.end({ timeout: 1 });
    }
  });
});
