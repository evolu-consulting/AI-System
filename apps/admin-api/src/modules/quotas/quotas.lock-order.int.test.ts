// ADM-FR-40, ADM-NFR-07 · plan M4 §6 hạng 11a: Quota PUT (tenant NKU → features SHARE → tenant_quotas) ∥ Feature DELETE
// (feature NKU → cascade tenant_quotas) xen kẽ tất định — không deadlock, kết quả đúng thứ tự khoá.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { createDb, runMigrations } from "@ai/db";
import { resetTestDb } from "@ai/db/test-db";
import postgres from "postgres";
import { barrier, codeOf, lockKit } from "../../lib/lock-order.helpers";
import type { TestHooks } from "../../lib/test-hooks";
import { deleteFeature } from "../features/features.service";
import { putQuotas } from "./quotas.service";

const OWNER = process.env.TEST_DATABASE_URL;
const API = process.env.TEST_ADMIN_API_DATABASE_URL;
if (!OWNER || !API) throw new Error("TEST_DATABASE_URL/TEST_ADMIN_API_DATABASE_URL chưa đặt");

const n = (k: number) => `01900000-0000-7000-8000-0000000dd${String(k).padStart(3, "0")}`;
const [TID, ADMIN, F1] = [n(1), n(2), n(3)];
const owner = postgres(OWNER, { max: 1, onnotice: () => {} });
const db = createDb(API, { max: 6 });
const { interleave } = lockKit(owner);
const platform = { kind: "platform" } as const;
const qc = (hooks?: TestHooks) => ({
  ctx: { db, now: () => new Date(), hooks },
  scope: platform,
  actor: { userId: ADMIN },
});
const fc = (hooks?: TestHooks) => ({
  ctx: { db, hooks },
  scope: platform,
  actor: { userId: ADMIN, tenantId: TID, tenantKey: "lockq", role: "platform_admin", sid: null },
});
const ver = async () =>
  Number((await owner`select version as v from admin.tenants where id = ${TID}`)[0]?.v);
const quotaRows = async () =>
  Number(
    (await owner`select count(*)::int as n from admin.tenant_quotas where tenant_id = ${TID}`)[0]
      ?.n,
  );
const item = { feature_id: F1, max_runs: 10, max_tokens: null, max_usd: null };

beforeAll(async () => {
  await resetTestDb(OWNER);
  await runMigrations({ url: OWNER, appEnv: "test" });
});
beforeEach(async () => {
  await owner`truncate admin.tenant_quotas, admin.features, admin.users, admin.tenants cascade`;
  await owner`insert into admin.tenants (id, key, name) values (${TID}, 'lockq', 'Lock Q')`;
  await owner`insert into admin.users (id, tenant_id, username, password_hash, display_name, role)
    values (${ADMIN}, ${TID}, 'boss', 'h', 'Boss', 'member')`;
  await owner`insert into admin.features (id, key, name) values (${F1}, 'f-q', '{"vi":"F"}')`;
});
afterAll(async () => {
  await db.close();
  await owner.end();
});

describe("ADM-FR-40 · plan M4 §6 hạng 11a · Quota PUT ∥ Feature DELETE", () => {
  it("QL1 · PUT giữ feature SHARE ∥ DELETE feature chờ → PUT xong, DELETE xong, quota bị cascade; 0 deadlock", async () => {
    const v0 = await ver();
    const b = barrier("quota.save");
    const r = await interleave(
      () => putQuotas(qc(b.hooks), TID, { version: v0, items: [item] }),
      () => deleteFeature(fc() as never, F1),
      b,
    );
    expect([r.ra.ok, r.rb.ok, await ver(), await quotaRows(), r.deadlocks]).toEqual([
      true,
      true,
      v0 + 1,
      0,
      0,
    ]);
  });

  it("QL2 · DELETE feature giữ NKU ∥ PUT chờ SHARE → feature đã xoá → INVALID_REFERENCE; version không đổi", async () => {
    const v0 = await ver();
    const b = barrier("feature.delete");
    const r = await interleave(
      () => deleteFeature(fc(b.hooks) as never, F1),
      () => putQuotas(qc(), TID, { version: v0, items: [item] }),
      b,
    );
    expect([r.ra.ok, codeOf(r.rb), await ver(), await quotaRows(), r.deadlocks]).toEqual([
      true,
      "INVALID_REFERENCE",
      v0,
      0,
      0,
    ]);
  });
});
