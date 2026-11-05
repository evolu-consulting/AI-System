// CR-121 Q-1 · int: danh sách công ty lọc theo Ứng dụng (`app`) + cột `apps` trong CÙNG một câu SQL (không theo hàng).
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
const T_B = "01900000-0000-7000-8000-0000000a1002"; // knowledge-read + contracts-approval-engine (ẩn ⇒ không tính contracts)
const T_C = "01900000-0000-7000-8000-0000000a1003"; // contracts-read đã thu hồi ⇒ không có app nào
const KEYS = [
  "chat-app",
  "contracts-read",
  "contracts-write",
  "contracts-approval-engine",
  "knowledge-read",
];

beforeAll(async () => {
  await resetTestDb(OWNER);
  await runMigrations({ url: OWNER, appEnv: "test" });
  await owner`truncate admin.feature_entitlements, admin.users, admin.tenants cascade`;
  for (const k of KEYS)
    await owner`insert into admin.features (key, name) values (${k}, ${owner.json({ vi: k, en: k })})
      on conflict (key) do nothing`;
  await owner`insert into admin.tenants (id, key, name) values
    (${T_A}, 'q1-a', 'Q1 A'), (${T_B}, 'q1-b', 'Q1 B'), (${T_C}, 'q1-c', 'Q1 C')`;
  const grant = (t: string, k: string, revoked = false) =>
    owner`insert into admin.feature_entitlements (feature_id, tenant_id, revoked_at)
      select id, ${t}::uuid, ${revoked ? new Date() : null}::timestamptz from admin.features where key = ${k}`;
  for (const k of ["chat-app", "contracts-read", "contracts-write"]) await grant(T_A, k);
  for (const k of ["knowledge-read", "contracts-approval-engine"]) await grant(T_B, k);
  await grant(T_C, "contracts-read", true);
});
afterAll(async () => {
  await ctx.db.close();
  await owner.end();
});

const list = (app?: "chat" | "contracts" | "knowledge" | "community") =>
  listTenants(ctx, PLATFORM, { limit: 50, offset: 0, ...(app ? { app } : {}) } as never);

describe("CR-121 Q-1 · GET /admin/tenants?app=", () => {
  test("lọc app=contracts chỉ trả công ty đang bật, bỏ revoked và feature ẩn", async () => {
    const r = await list("contracts");
    expect(r.items.map((t) => t.key)).toEqual(["q1-a"]);
    expect(r.total).toBe(1);
    expect(r.counts.all).toBe(1);
  });

  test("lọc chat dùng khoá chat-app; lọc app không ai bật ⇒ rỗng", async () => {
    expect((await list("chat")).items.map((t) => t.key)).toEqual(["q1-a"]);
    expect((await list("community")).items).toEqual([]);
  });

  test("mỗi hàng trả apps (đã khử trùng, sắp theo khoá) từ cùng câu SQL", async () => {
    const r = await list();
    const by = Object.fromEntries(r.items.map((t) => [t.key, t.apps]));
    expect(by["q1-a"]).toEqual(["chat", "contracts"]);
    expect(by["q1-b"]).toEqual(["knowledge"]);
    expect(by["q1-c"]).toEqual([]);
  });
});
