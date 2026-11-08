// CR-125 B1 · S1b · assertSafeDbRole (hub-api): owner/superuser bị chặn, role thường sở hữu bảng hub bị chặn, hub_api qua.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb, runMigrations } from "@ai/db";
import { runHubMigrations } from "@ai/db/migrate-hub";
import { resetTestDb, withDatabase } from "@ai/db/test-db";
import { sql } from "drizzle-orm";
import { assertSafeDbRole, UNSAFE_ROLE_MESSAGE } from "./db-guard";

const BASE = process.env.HUB_TEST_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
if (!BASE)
  throw new Error("HUB_TEST_DATABASE_URL/TEST_DATABASE_URL chưa đặt — chạy `bun run keys:dev`");
const OWNER = process.env.HUB_TEST_DATABASE_URL ?? withDatabase(BASE, "ai_system_h1_test");
const asRole = (user: string, pw: string) => {
  const u = new URL(OWNER);
  u.username = user;
  u.password = pw;
  return u.toString();
};
const PROBE = "hub_api_guard_probe";

const owner = createDb(OWNER, { max: 1 });
const api = createDb(asRole("hub_api", "hub_api_dev_pw"), { max: 1 });
beforeAll(async () => {
  await resetTestDb(OWNER);
  await runMigrations({ url: OWNER, appEnv: "test" });
  await runHubMigrations({ url: OWNER, appEnv: "test" });
});
afterAll(async () => {
  await owner.db.execute(sql.raw(`drop table if exists hub.guard_probe_t`));
  await owner.db.execute(sql.raw(`drop role if exists ${PROBE}`));
  await owner.close();
  await api.close();
});

describe("CR-125 S1b · hub-api assertSafeDbRole (int)", () => {
  test("owner (superuser) ⇒ ném", async () => {
    await expect(assertSafeDbRole(owner)).rejects.toThrow(UNSAFE_ROLE_MESSAGE);
  });

  test("hub_api ⇒ qua (không bị role gói SET-được làm vướng)", async () => {
    await expect(assertSafeDbRole(api)).resolves.toBeUndefined();
  });

  test("role thường (NOSUPERUSER NOBYPASSRLS) sở hữu một bảng hub ⇒ ném", async () => {
    await owner.db.execute(sql.raw(`drop table if exists hub.guard_probe_t`));
    await owner.db.execute(sql.raw(`drop role if exists ${PROBE}`));
    await owner.db.execute(
      sql.raw(`create role ${PROBE} login password 'probe_pw' nosuperuser nobypassrls`),
    );
    await owner.db.execute(sql.raw(`create table hub.guard_probe_t (id int)`));
    await owner.db.execute(sql.raw(`alter table hub.guard_probe_t owner to ${PROBE}`));
    const probe = createDb(asRole(PROBE, "probe_pw"), { max: 1 });
    try {
      await expect(assertSafeDbRole(probe)).rejects.toThrow(UNSAFE_ROLE_MESSAGE);
      await expect(assertSafeDbRole(probe, [])).resolves.toBeUndefined();
    } finally {
      await probe.close();
    }
  });
});
