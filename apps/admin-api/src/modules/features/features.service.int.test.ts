// ADM-FR-30, ADM-FR-31, ADM-BR-10 · service features trên DB thật (role admin_api): core bảo vệ, thay cả tập command,
// bump version hai chiều, entitlement thu hồi/cấp lại cùng hàng, setCommandFeatures cho module commands.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createDb, runMigrations, withScope } from "@ai/db";
import { resetTestDb } from "@ai/db/test-db";
import postgres from "postgres";
import { grantEntitlement, revokeEntitlement } from "./features.entitlements";
import {
  type Call,
  createFeature,
  deleteFeature,
  setCommandFeatures,
  updateFeature,
} from "./features.service";

const OWNER = process.env.TEST_DATABASE_URL;
const API = process.env.TEST_ADMIN_API_DATABASE_URL;
if (!OWNER || !API) throw new Error("TEST_DATABASE_URL/TEST_ADMIN_API_DATABASE_URL chưa đặt");

const id = (n: number) => `01900000-0000-7000-8000-00000000f0${String(n).padStart(2, "0")}`;
const [TID, UID, SID, WID, CORE, C1, C2, ACME] = [1, 2, 3, 4, 5, 6, 7, 8].map(id) as string[];
const owner = postgres(OWNER as string, { max: 1, onnotice: () => {} });
const db = createDb(API as string, { max: 2 });
const call: Call = {
  ctx: { db },
  actor: {
    userId: UID as string,
    tenantId: TID as string,
    tenantKey: "platform",
    role: "platform_admin",
    sid: null,
  },
  scope: { kind: "platform" },
};
const version = async (table: "commands" | "features", rid: string) =>
  Number(
    (await owner.unsafe(`select version from admin.${table} where id = $1`, [rid]))[0]?.version,
  );

/** Lỗi bị ném (thay `expect(p).rejects`: treo với Bun 1.3.14 khi promise giữ transaction postgres-js). */
const caught = (p: Promise<unknown>): Promise<unknown> =>
  p.then(
    () => null,
    (e: unknown) => e,
  );

beforeAll(async () => {
  await resetTestDb(OWNER);
  await runMigrations({ url: OWNER as string, appEnv: "test" });
});
afterAll(async () => {
  await db.close();
  await owner.end();
});
beforeEach(async () => {
  await owner`truncate admin.tenants, admin.features, admin.secrets cascade`;
  await owner`insert into admin.tenants (id, key, name) values (${TID as string}, 'platform', 'P'), (${ACME as string}, 'acme', 'A')`;
  await owner`insert into admin.users (id, tenant_id, username, password_hash, display_name, role)
    values (${UID as string}, ${TID as string}, 'admin', 'h', 'A', 'platform_admin')`;
  await owner`insert into admin.features (id, key, name) values (${CORE as string}, 'core', '{"vi":"Cơ bản"}'::jsonb)`;
  await owner`insert into admin.secrets (id, name, ciphertext, iv, last4)
    values (${SID as string}, 'K_EY', ${Buffer.alloc(32)}, ${Buffer.alloc(12)}, 'abcd')`;
  await owner`insert into admin.workflows (id, key, name, description, app_type, base_url, secret_id)
    values (${WID as string}, 'wf', 'W', ${"d".repeat(20)}, 'chat', 'https://x.test', ${SID as string})`;
  for (const [cid, name] of [
    [C1, "c-one"],
    [C2, "c-two"],
  ] as const) {
    await owner`insert into admin.commands (id, name, description, workflow_id, output)
      values (${cid as string}, ${name}, '{"vi":"x"}'::jsonb, ${WID as string}, '{"field":"t","render":"text"}'::jsonb)`;
    await owner`insert into admin.feature_commands (feature_id, command_id) values (${CORE as string}, ${cid as string})`;
  }
});

describe("ADM-FR-30 · features.service", () => {
  test("ADM-BR-10 · core: status off → CORE_FEATURE_PROTECTED; xoá core → CORE_FEATURE_PROTECTED", async () => {
    expect(
      await caught(updateFeature(call, CORE as string, { version: 1, status: "off" })),
    ).toMatchObject({
      code: "CORE_FEATURE_PROTECTED",
    });
    expect(await caught(deleteFeature(call, CORE as string))).toMatchObject({
      code: "CORE_FEATURE_PROTECTED",
    });
  });

  test("ADM-FR-30 · tạo với command → version command +1; thay cả tập → bump hai chiều; xoá không bump command", async () => {
    const f = await createFeature(call, {
      key: "docs",
      name: { vi: "Tài liệu" },
      description: {},
      icon: "package",
      status: "on",
      command_ids: [C1 as string],
    });
    expect(await version("commands", C1 as string)).toBe(2);
    const u = await updateFeature(call, f.id, { version: 1, command_ids: [C2 as string] });
    expect(u.version).toBe(2);
    expect(u.commands.map((c) => c.name)).toEqual(["c-two"]);
    expect([
      await version("commands", C1 as string),
      await version("commands", C2 as string),
    ]).toEqual([3, 2]);
    await deleteFeature(call, f.id);
    expect(await version("commands", C2 as string)).toBe(2);
  });

  test("ADM-BR-10 · bỏ command chỉ thuộc core → COMMAND_NEEDS_FEATURE {commands}", async () => {
    expect(
      await caught(
        updateFeature(call, CORE as string, { version: 1, command_ids: [C1 as string] }),
      ),
    ).toMatchObject({
      code: "COMMAND_NEEDS_FEATURE",
      details: { commands: [{ id: C2, name: "c-two" }] },
    });
  });

  test("ADM-FR-31 · thu hồi rồi cấp lại → cùng hàng; core → CORE_FEATURE_PROTECTED", async () => {
    const f = await createFeature(call, {
      key: "docs",
      name: { vi: "Tài liệu" },
      description: {},
      icon: "package",
      status: "on",
      command_ids: [],
    });
    const g = await grantEntitlement(call, f.id, ACME as string);
    expect(g).toMatchObject({ tenant_key: "acme", granted_by: "admin" });
    await revokeEntitlement(call, f.id, ACME as string);
    await grantEntitlement(call, f.id, ACME as string);
    const rows =
      await owner`select revoked_at from admin.feature_entitlements where feature_id = ${f.id}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.revoked_at).toBeNull();
    expect(await caught(grantEntitlement(call, CORE as string, ACME as string))).toMatchObject({
      code: "CORE_FEATURE_PROTECTED",
    });
  });

  test("ADM-BR-10 · setCommandFeatures: thay tập + bump version feature; id lạ → INVALID_REFERENCE", async () => {
    const f = await createFeature(call, {
      key: "docs",
      name: { vi: "Tài liệu" },
      description: {},
      icon: "package",
      status: "on",
      command_ids: [],
    });
    await withScope(db, call.scope, (tx) =>
      setCommandFeatures(tx, {
        commandId: C1 as string,
        featureIds: [f.id],
        actorId: UID as string,
      }),
    );
    expect([await version("features", f.id), await version("features", CORE as string)]).toEqual([
      2, 2,
    ]);
    expect(
      await caught(
        withScope(db, call.scope, (tx) =>
          setCommandFeatures(tx, {
            commandId: C1 as string,
            featureIds: [id(99)],
            actorId: UID as string,
          }),
        ),
      ),
    ).toMatchObject({ code: "INVALID_REFERENCE", details: { field: "feature_ids" } });
  });
});
