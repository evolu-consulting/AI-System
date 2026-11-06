// CR-121 c20 (D3) · int (DB test, role hub_api, scope system): check `tenant_profile` chạy một lượt ops-watch THẬT.
// Quy tắc 2: công ty có tên rỗng ⇒ crit + mẫu nêu key; sửa ⇒ ok. Quy tắc 1: cột `company_name` quay lại ⇒ crit; gỡ ⇒ ok.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { tenantId } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { connectDb, type Db } from "../../lib/db";
import { tenantProfileCheck } from "./adapters/checks/tenant-profile.check";
import { runChecksOnce } from "./application/ops.round";
import { opsRoundDeps } from "./ops.mount";

const T = tenantId(2201);

let o: Sql;
let db: Db;
const NOW = new Date("2026-11-06T08:00:00Z");
type Row = { status: string; message: string; value: Record<string, number> };
let minute = 0;
const round = async (): Promise<Row> => {
  await o`update hub.ops_settings set last_round_at = null where id = 1`;
  await runChecksOnce(
    opsRoundDeps({
      db,
      ops: { checks: [tenantProfileCheck], timeoutMs: 5_000 },
      log: console as never,
    }),
    new Date(NOW.getTime() + 31 * 60_000 * minute++),
  );
  const [r] = await o<
    Row[]
  >`select status, message, value from hub.ops_checks where check_key = 'tenant_profile'`;
  return r as Row;
};

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 4);
}, 120_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-121 c20 · ops check tenant_profile", () => {
  it("sạch ⇒ ok; tên công ty rỗng ⇒ crit nêu key; sửa tên ⇒ ok", async () => {
    expect((await round()).status).toBe("ok");
    await o`insert into admin.tenants (id, key, name) values (${T}, 't2201', ' ')`;
    const bad = await round();
    expect([bad.status, bad.value.rule2]).toEqual(["crit", 1]);
    expect(bad.message).toContain("t2201");
    await o`update admin.tenants set name = 'Có tên' where id = ${T}`;
    expect((await round()).status).toBe("ok");
  });

  it("cột company_settings.company_name quay lại ⇒ crit; gỡ cột ⇒ ok", async () => {
    await o`alter table contracts.company_settings add column company_name text`;
    const bad = await round();
    expect([bad.status, bad.value.rule1]).toEqual(["crit", 1]);
    await o`alter table contracts.company_settings drop column company_name`;
    expect((await round()).status).toBe("ok");
  });
});
