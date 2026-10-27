// tenant-quotas · /admin/tenants/:id/daily-limits: đường chính GET/PUT/reset (platform_admin), 403 cho tenant_admin, và RLS
// chặn đọc chéo tenant trên `admin.tenant_daily_limits`.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { createDb, type Db, tenantDailyLimits, withScope } from "@ai/db";
import { TENANT_ID } from "../../../../../tests/acceptance/M1/_data";
import { ADMIN_API_URL, createEnv, type Env } from "../../../../../tests/acceptance/M1/_fixtures";

const ACME = TENANT_ID.acme;
const path = `/admin/tenants/${ACME}/daily-limits`;

let env: Env;
let db: Db;
beforeAll(async () => {
  env = await createEnv();
  db = createDb(ADMIN_API_URL, { max: 2 });
});
afterAll(async () => {
  await db.close();
  await env.close();
});
beforeEach(() => env.reset());

type Item = {
  kind: string;
  override: number | null;
  effective: number | null;
  used: number | null;
};
const byKind = (items: Item[]) => Object.fromEntries(items.map((i) => [i.kind, i]));
const audits = () =>
  env.owner<{ n: number }[]>`select count(*)::int as n from admin.audit_log
    where entity = 'quota' and tenant_id = ${ACME} and entity_name like 'daily_limits%'`;

describe("tenant-quotas · daily-limits API", () => {
  it("platform_admin: GET mặc định env ⇒ PUT giá trị riêng ⇒ đặt lại token AI hôm nay; mỗi lần ghi có audit", async () => {
    const token = await env.token("platform", "admin");
    const g = await env.get(path, { token });
    expect(g.status).toBe(200);
    const k0 = byKind(g.json.items);
    expect(k0.uploads).toMatchObject({ override: null, effective: 30, used: null }); // test không có Redis ⇒ used null
    // DB test chỉ có migration Admin (hub.usage_logs thiếu cột `feature`) ⇒ token đã dùng = null, không 500.
    expect(k0.ai_tokens).toMatchObject({ override: null, effective: 5_000_000, used: null });

    const p = await env.call("PUT", path, {
      token,
      body: { uploads: 50, actions: null, ai_tokens: 1000 },
    });
    expect(p.status).toBe(200);
    const k1 = byKind(p.json.items);
    expect(k1.uploads).toMatchObject({ override: 50, effective: 50 });
    expect(k1.actions).toMatchObject({ override: null, effective: 100 });
    expect(k1.ai_tokens).toMatchObject({ override: 1000, effective: 1000 });
    expect((await audits())[0]?.n).toBe(1);

    const r = await env.post(`${path}/ai_tokens/reset`, { token });
    expect(r.status).toBe(200);
    const [row] = await env.owner<{ at: Date | null }[]>`
      select ai_tokens_reset_at as at from admin.tenant_daily_limits where tenant_id = ${ACME}`;
    expect(row?.at).not.toBeNull();
    expect((await audits())[0]?.n).toBe(2);

    // Không có Redis ⇒ đặt lại lượt tải trả 503 rõ ràng, không ghi audit.
    const u = await env.post(`${path}/uploads/reset`, { token });
    expect(u.status).toBe(503);
    expect((await audits())[0]?.n).toBe(2);
  });

  it("tenant_admin ⇒ 403 cho cả GET/PUT/reset", async () => {
    const token = await env.token("acme", "binh");
    expect((await env.get(path, { token })).status).toBe(403);
    const body = { uploads: 1, actions: 1, ai_tokens: 1 };
    expect((await env.call("PUT", path, { token, body })).status).toBe(403);
    expect((await env.post(`${path}/uploads/reset`, { token })).status).toBe(403);
  });

  it("RLS: scope tenant globex không đọc/ghi được hàng của acme", async () => {
    await env.owner`insert into admin.tenant_daily_limits (tenant_id, uploads_day) values (${ACME}, 9)`;
    const seen = await withScope(db, { kind: "tenant", tenantId: TENANT_ID.globex }, (tx) =>
      tx.select().from(tenantDailyLimits),
    );
    expect(seen).toEqual([]);
    const upd = await withScope(db, { kind: "tenant", tenantId: TENANT_ID.globex }, (tx) =>
      tx.update(tenantDailyLimits).set({ uploadsDay: 1 }).returning(),
    );
    expect(upd).toEqual([]);
    const own = await withScope(db, { kind: "tenant", tenantId: ACME }, (tx) =>
      tx.select().from(tenantDailyLimits),
    );
    expect(own.map((r) => r.uploadsDay)).toEqual([9]);
  });
});
