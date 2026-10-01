// ADM-FR-63, ADM-FR-05, ADM-FR-02, ADM-FR-20, ADM-FR-30 · review vòng 2 N1 + M2 plan §5.1/§6 (G8): khoá hàng khi ghi user (FOR NO KEY UPDATE) không deadlock với
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
import { createCommand, updateCommand } from "../modules/commands/commands.service";
import { deleteFeature, updateFeature } from "../modules/features/features.service";
import * as usersRepo from "../modules/users/users.repo";
import { type Call, createUser, lockUser, resetPassword } from "../modules/users/users.service";
import { updateWorkflow } from "../modules/workflows/workflows.service";
import { loadJwtKeys } from "./jwt";
import type { HookOp, TestHooks } from "./test-hooks";

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
  await owner`select pg_stat_force_next_flush(), pg_stat_clear_snapshot()`;
  const [r] = await owner`select deadlocks::int as n from pg_stat_database
    where datname = current_database()`;
  return Number(r?.n ?? 0);
};

/**
 * Số deadlock tăng thêm so với `before`. Backend phát hiện deadlock chỉ đẩy thống kê khi rảnh (tối đa ~1 s), nên poll
 * tới hạn chót thay vì ngủ cố định; tăng là trả ngay (fail sớm).
 */
async function deadlocksSince(before: number, deadlineMs = 1500): Promise<number> {
  const end = Date.now() + deadlineMs;
  for (;;) {
    const n = (await deadlocks()) - before;
    if (n > 0 || Date.now() >= end) return n;
    await Bun.sleep(50);
  }
}

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

/** Hook dừng đúng một lần ở `target` sau khi đã giữ khoá; test mở bằng tay. */
function barrier(target: HookOp) {
  let open: () => void = () => undefined;
  let reached: () => void = () => undefined;
  const opened = new Promise<void>((r) => {
    open = r;
  });
  const locked = new Promise<void>((r) => {
    reached = r;
  });
  let used = false;
  const hooks: TestHooks = {
    afterLock: async (op) => {
      if (op !== target || used) return;
      used = true;
      reached();
      await opened;
    },
  };
  return { hooks, locked, open: () => open() };
}

/** Chờ tới khi có ít nhất một backend đang đợi khoá hàng (wait_event_type = 'Lock'). */
async function waitForLockWait(): Promise<void> {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const [r] = await owner`select count(*)::int as n from pg_stat_activity
      where datname = current_database() and wait_event_type = 'Lock'`;
    if ((r?.n ?? 0) >= 1) return;
    await Bun.sleep(20);
  }
  throw new Error("không thấy request thứ hai chờ khoá");
}

type Settled = { ok: boolean; e?: unknown };
const settle = (p: Promise<unknown>): Promise<Settled> =>
  p.then(
    () => ({ ok: true }),
    (e) => ({ ok: false, e }),
  );

async function m2Interleave(
  first: () => Promise<unknown>,
  second: () => Promise<unknown>,
  b: { locked: Promise<void>; open: () => void },
) {
  const before = await deadlocks();
  const pa = settle(first());
  await b.locked;
  const pb = settle(second());
  await waitForLockWait();
  const t0 = performance.now();
  b.open();
  const [ra, rb] = await Promise.all([pa, pb]);
  const ms = performance.now() - t0;
  return { ra, rb, ms, deadlocks: await deadlocksSince(before) };
}

const featureCount = async (): Promise<number> => {
  const [r] =
    await owner`select count(*)::int as n from admin.feature_commands where command_id = ${CMD}`;
  return Number(r?.n ?? 0);
};
const codeOf = (r: Settled) => (r.e as { code?: string } | undefined)?.code;

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
});
