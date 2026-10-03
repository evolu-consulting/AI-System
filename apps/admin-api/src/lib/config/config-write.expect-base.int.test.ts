// ADM-FR-54 · `ConfigCall.expectBase` (plan-cd §2, D8): bump mà `v !== expectBase + 1` → `ConfigVersionMoved
// {current: v - 1}`, rollback (không bump, không audit). Không sự kiện → không kiểm.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { ConfigVersionMoved, createDb, runMigrations } from "@ai/db";
import { resetTestDb } from "@ai/db/test-db";
import postgres from "postgres";
import { auditOf } from "../audit/audit.write";
import { configWrite } from "./config-write";

const OWNER = process.env.TEST_DATABASE_URL;
const API = process.env.TEST_ADMIN_API_DATABASE_URL;
if (!OWNER || !API) throw new Error("TEST_DATABASE_URL/TEST_ADMIN_API_DATABASE_URL chưa đặt");

const owner = postgres(OWNER, { max: 1, onnotice: () => {} });
const db = createDb(API, { max: 2 });
const PLATFORM = "01900000-0000-7000-8000-0000000e0001";
const ROOT = "01900000-0000-7000-8000-0000000e0002";

const cfg = async () =>
  (await owner<{ v: number }[]>`select config_version as v from admin.config_meta`)[0]?.v ?? 0;
const audits = async () =>
  (await owner<{ n: number }[]>`select count(*)::int as n from admin.audit_log`)[0]?.n ?? 0;
const write = (expectBase: number | undefined, change = true) =>
  configWrite(
    { ctx: { db }, scope: { kind: "platform" }, actor: { userId: ROOT }, expectBase },
    "secret.save",
    async (_tx, ch) => {
      if (!change) return 0;
      ch.changed({ entity: "secret", tenantId: null });
      ch.audit(
        auditOf("update", "secret", {
          entityId: null,
          entityName: "T",
          tenantId: null,
          before: null,
          after: null,
        }),
      );
      return 1;
    },
  );

beforeAll(async () => {
  await resetTestDb(OWNER);
  await runMigrations({ url: OWNER, appEnv: "test" });
  await owner`insert into admin.tenants (id, key, name) values (${PLATFORM}, 'platform', 'P')`;
  await owner`insert into admin.users (id, tenant_id, username, password_hash, display_name, role)
    values (${ROOT}, ${PLATFORM}, 'root', 'h', 'R', 'platform_admin')`;
});
afterAll(async () => {
  await owner.end();
  await db.close();
});

describe("ADM-FR-54 · configWrite expectBase", () => {
  test("expectBase = hiện tại → commit, v = base + 1", async () => {
    const base = await cfg();
    await write(base);
    expect(await cfg()).toBe(base + 1);
  });

  test("expectBase lệch → ConfigVersionMoved {current}, rollback: không bump, không audit", async () => {
    const base = await cfg();
    const n = await audits();
    const err = await write(base - 1).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ConfigVersionMoved);
    expect((err as ConfigVersionMoved).current).toBe(base);
    expect(await cfg()).toBe(base);
    expect(await audits()).toBe(n);
  });

  test("không sự kiện → không kiểm (trả kết quả), vắng expectBase → như cũ", async () => {
    const base = await cfg();
    expect(await write(base + 7, false)).toBe(0);
    await write(undefined);
    expect(await cfg()).toBe(base + 1);
  });
});
