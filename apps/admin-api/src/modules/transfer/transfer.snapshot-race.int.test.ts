// ADM-FR-54 · C-A09 · plan-cd §2/D8: tx áp dụng chạy READ COMMITTED — một import khác cùng base commit GIỮA câu đọc
// `config_version` và câu đọc snapshot ⇒ trước đây kế hoạch thấy secret vừa tạo ("thừa") ⇒ 400 VALIDATION_ERROR thay vì
// 409 (lộ ra trên Linux/Bun 1.3.14, TECH-DEBT #233). Dừng tất định ở hook `versioned`, không sleep.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { randomBytes } from "node:crypto";
import { createDb, runMigrations } from "@ai/db";
import { resetTestDb } from "@ai/db/test-db";
import postgres from "postgres";
import type { Actor } from "../../lib/auth-middleware";
import { parseMasterKey } from "../../lib/secret-crypto";
import type { TestHooks } from "../../lib/test-hooks";
import { applyImport } from "./transfer.apply";

const OWNER = process.env.TEST_DATABASE_URL;
const API = process.env.TEST_ADMIN_API_DATABASE_URL;
if (!OWNER || !API) throw new Error("TEST_DATABASE_URL/TEST_ADMIN_API_DATABASE_URL chưa đặt");

const n = (k: number) => `01900000-0000-7000-8000-0000000ef${String(k).padStart(3, "0")}`;
const [TID, ADMIN] = [n(1), n(2)];
const owner = postgres(OWNER, { max: 1, onnotice: () => {} });
const db = createDb(API, { max: 4 });
const key = parseMasterKey(randomBytes(32).toString("base64"));
const actor = {
  userId: ADMIN,
  tenantId: TID,
  tenantKey: "platform",
  role: "platform_admin",
  sid: null,
} as unknown as Actor;
const call = (hooks?: TestHooks) => ({
  ctx: { db, now: () => new Date(), hooks, secretKey: key },
  scope: { kind: "platform" } as const,
  actor,
});

const content = JSON.stringify({
  format: "ai-system/config",
  format_version: 1,
  config_version: 1,
  exported_at: "2026-10-01T09:00:00.000Z",
  workflows: [
    {
      key: "wf-race",
      name: "Workflow race",
      description: "Workflow cho test import song song",
      app_type: "workflow",
      base_url: "https://dify.example.com/v1",
      secret: "RACE_KEY",
      input_schema: [],
      output_field: null,
      enabled: true,
    },
  ],
});
const cfg = async () =>
  Number((await owner`select config_version as v from admin.config_meta where id = 1`)[0]?.v ?? 0);
const req = (base: number) => ({
  file_name: "race.yaml",
  content,
  base_config_version: base,
  secrets: { RACE_KEY: "sk-race-value-0001" },
});
const outcome = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (e: { code?: string }) => e.code ?? String(e),
  );

beforeAll(async () => {
  await resetTestDb(OWNER);
  await runMigrations({ url: OWNER, appEnv: "test" });
});
beforeEach(async () => {
  await owner`truncate admin.workflows, admin.secrets, admin.users, admin.tenants, admin.config_meta cascade`;
  await owner`insert into admin.tenants (id, key, name) values (${TID}, 'platform', 'Platform')`;
  await owner`insert into admin.users (id, tenant_id, username, password_hash, display_name, role)
    values (${ADMIN}, ${TID}, 'admin', 'h', 'Admin', 'platform_admin')`;
});
afterAll(async () => {
  await db.close();
  await owner.end();
});

describe("ADM-FR-54 · C-A09 · import cùng base commit giữa câu đọc version và snapshot", () => {
  it("import B commit sau khi A đọc version ⇒ A 409 VERSION_CONFLICT {current} (không 400), B ghi đúng 1 lần", async () => {
    const base = await cfg();
    let inner: Promise<string> | null = null;
    const hooks: TestHooks = {
      afterLock: async (op, step) => {
        if (op !== "import.apply" || step !== "versioned" || inner) return;
        inner = outcome(applyImport(call(), req(base)));
        await inner; // B chạy trọn và commit trên kết nối khác trong khi A đứng giữa hai câu đọc
      },
    };
    const a = await applyImport(call(hooks), req(base)).then(
      () => ({ code: "ok" }) as { code?: string; details?: unknown },
      (e: { code?: string; details?: unknown }) => e,
    );
    expect([await inner, a.code, a.details]).toEqual([
      "ok",
      "VERSION_CONFLICT",
      { current: base + 1 },
    ]);
    expect(await cfg()).toBe(base + 1);
    const rows = await owner`select count(*)::int as n from admin.secrets where name = 'RACE_KEY'`;
    expect(rows[0]?.n).toBe(1);
  });
});
