// ADM-NFR-07 · assertSafeDbRole: owner/superuser bị chặn, admin_api qua (plan M1 §3.3).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb, runMigrations } from "@ai/db";
import { resetTestDb } from "@ai/db/test-db";
import { sql } from "drizzle-orm";
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

describe("ADM-NFR-07 · assertSafeDbRole — thành viên gián tiếp (review vòng 1 #4)", () => {
  const PROBE = "admin_api_guard_probe";
  const probeUrl = () => {
    const u = new URL(OWNER as string);
    u.username = PROBE;
    u.password = "probe_pw";
    return u.toString();
  };
  const withProbe = async (
    grant: string,
    fn: (db: ReturnType<typeof createDb>) => Promise<void>,
  ) => {
    const drop = async () => {
      await owner.db.execute(sql.raw(`drop role if exists ${PROBE}`));
    };
    await drop();
    await owner.db.execute(
      sql.raw(`create role ${PROBE} login password 'probe_pw' in role admin_rw`),
    );
    await owner.db.execute(sql.raw(grant));
    const db = createDb(probeUrl(), { max: 1 });
    try {
      await fn(db);
    } finally {
      await db.close();
      await drop();
    }
  };

  test("ADM-NFR-07 · thành viên của role superuser (owner) → ném", async () => {
    const ownerRole = new URL(OWNER as string).username;
    await withProbe(`grant ${ownerRole} to ${PROBE}`, async (db) => {
      await expect(assertSafeDbRole(db)).rejects.toThrow(UNSAFE_ROLE_MESSAGE);
    });
  });

  test("ADM-NFR-07 · role thường không thuộc role nguy hiểm → qua", async () => {
    await withProbe("select 1", async (db) => {
      await expect(assertSafeDbRole(db)).resolves.toBeUndefined();
    });
  });
});
