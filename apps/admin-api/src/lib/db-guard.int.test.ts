// ADM-NFR-07 · assertSafeDbRole: owner/superuser bị chặn, admin_api qua (plan M1 §3.3).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb, runMigrations } from "@ai/db";
import { resetTestDb } from "@ai/db/test-db";
import { assertSafeDbRole, UNSAFE_ROLE_MESSAGE } from "./db-guard";

const OWNER = process.env.TEST_DATABASE_URL;
const API = process.env.TEST_ADMIN_API_DATABASE_URL;
if (!OWNER || !API) throw new Error("TEST_DATABASE_URL/TEST_ADMIN_API_DATABASE_URL chưa đặt");

const owner = createDb(OWNER, { max: 1 });
const api = createDb(API, { max: 1 });
beforeAll(async () => {
  await resetTestDb(OWNER);
  await runMigrations({ url: OWNER, appEnv: "test" });
});
afterAll(async () => {
  await owner.close();
  await api.close();
});

describe("ADM-NFR-07 · assertSafeDbRole", () => {
  test("ADM-NFR-07 · owner (superuser) → ném, thông báo nêu ADMIN_API_DATABASE_URL", async () => {
    await expect(assertSafeDbRole(owner)).rejects.toThrow(UNSAFE_ROLE_MESSAGE);
  });

  test("ADM-NFR-07 · admin_api → qua", async () => {
    await expect(assertSafeDbRole(api)).resolves.toBeUndefined();
  });
});
