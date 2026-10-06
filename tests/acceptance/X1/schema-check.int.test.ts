// X1-AC15 · HUB-FR-95 · X1-R09 · Hub kiểm schema Admin lúc khởi động (plan §2.3, §7 QD; test-plan §2 AC15):
// `missingAdminColumns(db)` + `server.ts` thoát 1 khi thiếu `admin.workflows.side_effect`. DB = `HUB_TEST_DATABASE_URL`
// (prepareDb H1: Admin + Hub migrate); owner `drop column` trong ca, `finally` thêm lại `default false not null`.
// "side_effect theo cột" phía catalog Hub do A67 (`H2a/confirm.int.test.ts`, L04) phủ — `GET /commands` không có trường này.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { connectDb, type Db } from "../../../apps/hub-api/src/lib/db";
import {
  HUB_API_URL,
  insertFixture,
  type Keys,
  makeKeys,
  ownerSql,
  prepareDb,
  REDIS_TEST_URL,
  type Sql,
} from "../H1/_fixtures";
import { insertHubConfig } from "../H1/_hub";
import { loadSchemaCheck } from "./_modules";
import { exitWithin, type Proc, spawnProc, waitHealth } from "./_x1";

const PORT = 4053;
const COL = "admin.workflows.side_effect";
let sql: Sql;
let db: Db;
let k: Keys;

beforeAll(async () => {
  await prepareDb();
  sql = ownerSql();
  await insertFixture(sql);
  await insertHubConfig(sql);
  db = connectDb(HUB_API_URL, 2);
  k = await makeKeys();
  await addColumn();
}, 60_000);
afterAll(async () => {
  await addColumn();
  await db?.close();
  await sql?.end();
});

async function addColumn(): Promise<void> {
  await sql.unsafe(
    "alter table admin.workflows add column if not exists side_effect boolean default false not null",
  );
}
async function withoutColumn(fn: () => Promise<void>): Promise<void> {
  await sql.unsafe("alter table admin.workflows drop column if exists side_effect");
  try {
    await fn();
  } finally {
    await addColumn();
  }
}

const spawnHub = (): Proc =>
  spawnProc("apps/hub-api/src/server.ts", PORT, {
    APP_ENV: "test",
    HUB_PORT: String(PORT),
    HUB_DATABASE_URL: HUB_API_URL,
    REDIS_URL: REDIS_TEST_URL,
    JWT_PUBLIC_KEY: k.publicPem,
    HUB_INSTANCE_ID: "qc-x1-schema-check",
    LOG_LEVEL: "info",
  });

describe("X1-AC15 · missingAdminColumns", () => {
  it("X1-AC15 · plan §2.3 · REQUIRED_ADMIN_COLUMNS = [['workflows','side_effect']]; có cột → []", async () => {
    const m = await loadSchemaCheck();
    expect(m.REQUIRED_ADMIN_COLUMNS).toEqual([["workflows", "side_effect"]]);
    expect(await m.missingAdminColumns(db)).toEqual([]);
  });

  it("X1-AC15 · thiếu cột → ['admin.workflows.side_effect']", async () => {
    const m = await loadSchemaCheck();
    await withoutColumn(async () => {
      expect(await m.missingAdminColumns(db)).toEqual([COL]);
    });
  });
});

describe("X1-AC15 · server.ts khởi động", () => {
  it("X1-AC15 · X1-R09 · thiếu cột → hub-api thoát mã 1 trong ≤ 20 s, log `admin-schema-missing` nêu cột, không lắng nghe", async () => {
    await withoutColumn(async () => {
      const p = spawnHub();
      const code = await exitWithin(p, 20_000);
      const out = await p.stop();
      expect(code).toBe(1);
      expect(out).toContain("admin-schema-missing");
      expect(out).toContain(COL);
      expect(await fetch(`${p.base}/health`).catch(() => null)).toBeNull();
    });
  }, 40_000);

  it("X1-AC15 · có cột → hub-api lên, /health 200 (không thoát)", async () => {
    const p = spawnHub();
    try {
      expect(await waitHealth(p)).toBe(200);
      expect(p.proc.exitCode).toBeNull();
    } finally {
      await p.stop();
    }
  }, 40_000);
});
