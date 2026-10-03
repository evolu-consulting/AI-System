// ADM-FR-54 · review M4 vòng 2 · readIds chỉ tra khoá trong file (DB > trần vẫn đọc id được); export vượt trần →
// 400 VALIDATION_ERROR too_big (không mượn 413 PAYLOAD_TOO_LARGE của kích thước file).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { ImportItem } from "@ai/contracts";
import { createDb, runMigrations, withScope } from "@ai/db";
import { resetTestDb } from "@ai/db/test-db";
import postgres from "postgres";
import { readIds } from "./transfer.ids";
import { SNAPSHOT_ROW_CAP } from "./transfer.repo";
import { exportConfig } from "./transfer.service";

const OWNER = process.env.TEST_DATABASE_URL;
const API = process.env.TEST_ADMIN_API_DATABASE_URL;
if (!OWNER || !API) throw new Error("TEST_DATABASE_URL/TEST_ADMIN_API_DATABASE_URL chưa đặt");

const TID = "01900000-0000-7000-8000-0000000ef001";
const owner = postgres(OWNER, { max: 1, onnotice: () => {} });
const db = createDb(API, { max: 2 });
const platform = { kind: "platform" } as const;
const call = { ctx: { db, now: () => new Date() }, scope: platform, actor: {} } as never;

beforeAll(async () => {
  await resetTestDb(OWNER);
  await runMigrations({ url: OWNER, appEnv: "test" });
  await owner`truncate admin.tenants, admin.config_meta cascade`;
  await owner`insert into admin.tenants (id, key, name) values (${TID}, 'big', 'Big')`;
  await owner`insert into admin.groups (tenant_id, key, name)
    select ${TID}, 'g' || i, '{"vi":"G"}' from generate_series(1, ${SNAPSHOT_ROW_CAP + 1}) i`;
});
afterAll(async () => {
  await owner`truncate admin.tenants cascade`;
  await db.close();
  await owner.end();
});

describe("ADM-FR-54 · review M4 vòng 2 · trần theo DB", () => {
  it("TI1 · readIds với file nhỏ khi DB có > trần group → chỉ id của khoá trong file, không ném", async () => {
    const items = [
      {
        type: "grant",
        key: "big/g7/f1",
        op: "add",
        before: null,
        after: { tenant: "big", group: "g7", feature: "f1" },
      },
      { type: "group", key: "big/g9", op: "update", before: null, after: { tenant: "big" } },
    ] as unknown as ImportItem[];
    const ids = await withScope(db, platform, (tx) => readIds(tx, items));
    expect([...ids.groups.keys()].sort()).toEqual(["big/g7", "big/g9"]);
    expect([...ids.tenants.keys()]).toEqual(["big"]);
    expect(ids.features.size).toBe(0);
  });

  it("TI2 · export loại vượt trần → 400 VALIDATION_ERROR too_big [groups], không PAYLOAD_TOO_LARGE", async () => {
    const err = (await exportConfig(call, ["groups"]).catch((e) => e)) as {
      code?: string;
      status?: number;
      details?: { issues?: unknown[] };
    };
    expect([err.code, err.status]).toEqual(["VALIDATION_ERROR", 400]);
    expect(err.details?.issues?.[0]).toMatchObject({ path: ["groups"], code: "too_big" });
  });
});
