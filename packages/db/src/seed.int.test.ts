// ADM-NFR-06 · runSeed idempotent + một transaction (plan M1 §7, §10 G13).
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import postgres from "postgres";
import { runMigrations } from "./migrate";
import { runSeed } from "./seed";
import { resetTestDb } from "./test-db";

const URL = process.env.TEST_DATABASE_URL;
if (!URL) throw new Error("TEST_DATABASE_URL chưa đặt — chạy `bun run keys:dev`");
const sql = postgres(URL, { max: 1, onnotice: () => {} });
const OPTS = { url: URL, adminUsername: "admin", adminPassword: "Seed-Admin-Pw-01" };
const counts = async () =>
  (
    await sql`select (select count(*)::int from admin.tenants) as t,
      (select count(*)::int from admin.features) as f, (select count(*)::int from admin.users) as u`
  )[0];

beforeAll(async () => {
  await resetTestDb(URL);
  await runMigrations({ url: URL, appEnv: "test" });
});
beforeEach(async () => {
  await sql`truncate admin.refresh_tokens, admin.users, admin.tenants, admin.features cascade`;
});
afterAll(() => sql.end());

describe("ADM-NFR-06 · runSeed", () => {
  test("ADM-NFR-06 · 2 lần → 1/1/1 hàng, hash không đổi", async () => {
    expect(await runSeed(OPTS)).toEqual({
      tenant: "created",
      feature: "created",
      admin: "created",
    });
    const [a] = await sql`select password_hash from admin.users`;
    expect(await runSeed(OPTS)).toEqual({ tenant: "exists", feature: "exists", admin: "exists" });
    expect(await counts()).toEqual({ t: 1, f: 1, u: 1 });
    const [b] = await sql`select password_hash from admin.users`;
    expect(b?.password_hash).toBe(a?.password_hash);
  });

  test("ADM-NFR-06 · lỗi giữa chừng (username vi phạm CHECK) → rollback, không còn hàng nào", async () => {
    await expect(runSeed({ ...OPTS, adminUsername: "BAD NAME" })).rejects.toThrow();
    expect(await counts()).toEqual({ t: 0, f: 0, u: 0 });
  });
});
