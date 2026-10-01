// ADM-FR-20, ADM-FR-22, ADM-FR-24, ADM-BR-01 · service commands trên DB thật (role admin_api): trùng tên/alias, song song
// cùng tên, input map, WORKFLOW_DISABLED, mặc định core, access.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { CommandCreateRequest } from "@ai/contracts";
import { createDb, runMigrations } from "@ai/db";
import { resetTestDb } from "@ai/db/test-db";
import postgres from "postgres";
import { commandAccess } from "./commands.access";
import { type Call, createCommand, deleteCommand, updateCommand } from "./commands.service";

const OWNER = process.env.TEST_DATABASE_URL;
const API = process.env.TEST_ADMIN_API_DATABASE_URL;
if (!OWNER || !API) throw new Error("TEST_DATABASE_URL/TEST_ADMIN_API_DATABASE_URL chưa đặt");

const id = (n: number) => `01900000-0000-7000-8000-00000000cc${String(n).padStart(2, "0")}`;
const [TID, UID, SID, WF, WF_OFF, CORE] = [1, 2, 3, 4, 5, 6].map(id) as [
  string,
  string,
  string,
  string,
  string,
  string,
];
const owner = postgres(OWNER, { max: 1, onnotice: () => {} });
const db = createDb(API, { max: 4 });
const call: Call = {
  ctx: { db },
  actor: { userId: UID, tenantId: TID, tenantKey: "platform", role: "platform_admin", sid: null },
  scope: { kind: "platform" },
};
/** Lỗi bị ném (thay cho `expect(p).rejects`, treo với Bun 1.3.14 khi promise giữ transaction postgres-js). */
const caught = (p: Promise<unknown>): Promise<unknown> =>
  p.then(
    () => null,
    (e: unknown) => e,
  );
const body = (over: Partial<CommandCreateRequest> = {}): CommandCreateRequest => ({
  name: "dich",
  aliases: ["tr"],
  description: { vi: "Dịch" },
  workflow_id: WF,
  args: [{ name: "text", description: { vi: "t" }, default: null, fallback: null, rest: true }],
  input_map: { text: { source: "arg", value: "text" } },
  output: { field: "text", render: "markdown" },
  mode: "sync",
  enabled: true,
  ...over,
});

beforeAll(async () => {
  await resetTestDb(OWNER);
  await runMigrations({ url: OWNER, appEnv: "test" });
});
afterAll(async () => {
  await db.close();
  await owner.end();
});
beforeEach(async () => {
  await owner`truncate admin.tenants, admin.features, admin.secrets cascade`;
  await owner`insert into admin.tenants (id, key, name) values (${TID}, 'platform', 'P')`;
  await owner`insert into admin.users (id, tenant_id, username, password_hash, display_name, role)
    values (${UID}, ${TID}, 'admin', 'h', 'A', 'platform_admin')`;
  await owner`insert into admin.features (id, key, name) values (${CORE}, 'core', '{"vi":"Cơ bản"}'::jsonb)`;
  await owner`insert into admin.secrets (id, name, ciphertext, iv, last4)
    values (${SID}, 'K_EY', ${Buffer.alloc(32)}, ${Buffer.alloc(12)}, 'abcd')`;
  await owner`insert into admin.workflows (id, key, name, description, app_type, base_url, secret_id, input_schema, enabled)
    values (${WF}, 'tr', 'W', ${"d".repeat(20)}, 'chat', 'https://x.test', ${SID},
      '[{"name":"text","type":"text","required":true,"description":"Văn bản"}]'::jsonb, true),
      (${WF_OFF}, 'off', 'W2', ${"d".repeat(20)}, 'chat', 'https://x.test', ${SID}, '[]'::jsonb, false)`;
});

describe("ADM-FR-20 · commands.service", () => {
  test("ADM-FR-20 · mặc định core; tên/alias trùng → COMMAND_NAME_TAKEN; xoá giải phóng tên", async () => {
    const c = await createCommand(call, body());
    expect(c.feature_ids).toEqual([CORE]);
    expect(c.timeout_s).toBe(30);
    expect(await caught(createCommand(call, body({ name: "tr", aliases: [] })))).toMatchObject({
      code: "COMMAND_NAME_TAKEN",
      details: { name: "tr" },
    });
    await deleteCommand(call, c.id);
    expect((await createCommand(call, body({ name: "tr", aliases: [] }))).name).toBe("tr");
  });

  test("ADM-BR-01 · M2-AC03 · hai POST cùng tên song song → đúng một thành công", async () => {
    const r = await Promise.allSettled([createCommand(call, body()), createCommand(call, body())]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    const lose = r.find((x) => x.status === "rejected") as PromiseRejectedResult;
    expect(lose.reason).toMatchObject({ code: "COMMAND_NAME_TAKEN" });
  });

  test("ADM-FR-22 · input map thiếu → INPUT_MAP_INVALID; workflow tắt + bật → WORKFLOW_DISABLED", async () => {
    expect(await caught(createCommand(call, body({ input_map: {} })))).toMatchObject({
      code: "INPUT_MAP_INVALID",
      details: { missing: ["text"], unknown: [], unknown_args: [] },
    });
    expect(
      await caught(
        createCommand(
          call,
          body({ name: "x-off", aliases: [], workflow_id: WF_OFF, args: [], input_map: {} }),
        ),
      ),
    ).toMatchObject({ code: "WORKFLOW_DISABLED" });
  });

  test("ADM-FR-20 · PATCH alias = tên chính (chỉ gửi aliases) → VALIDATION_ERROR; không đổi gì → không tăng version", async () => {
    const c = await createCommand(call, body());
    expect(
      await caught(updateCommand(call, c.id, { version: 1, aliases: ["dich"] })),
    ).toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect((await updateCommand(call, c.id, { version: 1, aliases: ["tr"] })).version).toBe(1);
  });

  test("ADM-FR-24 · access: core → mọi tenant, command_active", async () => {
    const c = await createCommand(call, body());
    const a = await commandAccess(call, c.id, { limit: 50, offset: 0 });
    expect(a).toMatchObject({ total: 1, command_active: true });
    expect(a.items[0]).toMatchObject({ tenant_key: "platform", active_user_count: 1 });
  });
});
