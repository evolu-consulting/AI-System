// CR-121 Q-1 · int: danh sách công ty lọc theo Ứng dụng (`app`) + cột `apps` trong CÙNG một câu SQL (không theo hàng).
// CR-121 c18 · app của feature = CỘT `admin.features.app` (nguồn duy nhất), không suy từ tiền tố khoá.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb, runMigrations } from "@ai/db";
import { resetTestDb } from "@ai/db/test-db";
import postgres from "postgres";
import { listTenants } from "./tenants.service";

const OWNER = process.env.TEST_DATABASE_URL;
const API = process.env.TEST_ADMIN_API_DATABASE_URL;
if (!OWNER || !API) throw new Error("TEST_DATABASE_URL/TEST_ADMIN_API_DATABASE_URL chưa đặt");

const owner = postgres(OWNER, { max: 1, onnotice: () => {} });
const ctx = { db: createDb(API, { max: 2 }) };
const PLATFORM = { kind: "platform" } as const;
const T_A = "01900000-0000-7000-8000-0000000a1001"; // contracts (read+write) + chat
const T_B = "01900000-0000-7000-8000-0000000a1002"; // knowledge-read + `contracts-odd` (app=other ⇒ cột thắng tiền tố: không tính contracts)
const T_C = "01900000-0000-7000-8000-0000000a1003"; // contracts-read đã thu hồi + `zz-sales` (app=contracts dù khoá không có tiền tố)
// [key, app] — ghi `app` tường minh: bộ lọc phải đọc CỘT.
const FEATURES: [string, string][] = [
  ["chat-app", "chat"],
  ["contracts-read", "contracts"],
  ["contracts-write", "contracts"],
  ["contracts-odd", "other"],
  ["zz-sales", "contracts"],
  ["knowledge-read", "knowledge"],
];

beforeAll(async () => {
  await resetTestDb(OWNER);
  await runMigrations({ url: OWNER, appEnv: "test" });
  await owner`truncate admin.feature_entitlements, admin.users, admin.tenants cascade`;
  for (const [k, app] of FEATURES)
    await owner`insert into admin.features (key, name, app) values (${k}, ${owner.json({ vi: k, en: k })}, ${app})
      on conflict (key) do update set app = excluded.app`;
  await owner`insert into admin.tenants (id, key, name) values
    (${T_A}, 'q1-a', 'Q1 A'), (${T_B}, 'q1-b', 'Q1 B'), (${T_C}, 'q1-c', 'Q1 C')`;
  // Tenant mới có thể được cấp sẵn feature mặc định (trigger/seed) ⇒ xoá trước để bộ dữ liệu chỉ có đúng phần của test.
  await owner`delete from admin.feature_entitlements where tenant_id in (${T_A}, ${T_B}, ${T_C})`;
  const grant = (t: string, k: string, revoked = false) =>
    owner`insert into admin.feature_entitlements (feature_id, tenant_id, revoked_at)
      select id, ${t}::uuid, ${revoked ? new Date() : null}::timestamptz from admin.features where key = ${k}`;
  for (const k of ["chat-app", "contracts-read", "contracts-write"]) await grant(T_A, k);
  for (const k of ["knowledge-read", "contracts-odd"]) await grant(T_B, k);
  await grant(T_C, "contracts-read", true);
  await grant(T_C, "zz-sales");
});
afterAll(async () => {
  await ctx.db.close();
  await owner.end();
});

const list = (app?: "chat" | "contracts" | "knowledge" | "community") =>
  listTenants(ctx, PLATFORM, { limit: 50, offset: 0, ...(app ? { app } : {}) } as never);

describe("CR-121 Q-1 · GET /admin/tenants?app=", () => {
  test("lọc app=contracts đọc cột `app`: có zz-sales (app=contracts), bỏ revoked và contracts-odd (app=other)", async () => {
    const r = await list("contracts");
    expect(r.items.map((t) => t.key)).toEqual(["q1-a", "q1-c"]);
    expect(r.total).toBe(2);
    expect(r.counts.all).toBe(2);
  });

  test("lọc chat theo cột app của chat-app; lọc app không ai bật ⇒ rỗng", async () => {
    expect((await list("chat")).items.map((t) => t.key)).toEqual(["q1-a"]);
    expect((await list("community")).items).toEqual([]);
  });

  test("mỗi hàng trả apps (đã khử trùng, sắp theo khoá) từ cùng câu SQL", async () => {
    const r = await list();
    const by = Object.fromEntries(r.items.map((t) => [t.key, t.apps]));
    expect(by["q1-a"]).toEqual(["chat", "contracts"]);
    expect(by["q1-b"]).toEqual(["knowledge"]); // contracts-odd (app=other) không tính
    expect(by["q1-c"]).toEqual(["contracts"]); // zz-sales (cột); contracts-read đã thu hồi
  });
});
