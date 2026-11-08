// CR-125 · G8 · int (DB test, role hub_api, scope system): check `flow_flag` chạy một lượt ops-watch THẬT.
// Công ty có `company_flows` đang bật mà cờ tắt/vắng ⇒ warn nêu tên; công ty không có dòng gán / dòng tắt / cờ đã bật ⇒ không bị nêu; bật cờ ⇒ ok.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { tenantId } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { connectDb, type Db } from "../../lib/db";
import { flowFlagCheck } from "./adapters/checks/flow-flag.check";
import { runChecksOnce } from "./application/ops.round";
import { opsRoundDeps } from "./ops.mount";

const MISSING = tenantId(2301); // có dòng gán bật, chưa có hàng cờ
const OFF = tenantId(2302); // có dòng gán bật, cờ tắt
const OK = tenantId(2303); // có dòng gán bật, cờ bật
const NONE = tenantId(2304); // không có dòng gán, cờ tắt
const DISABLED = tenantId(2305); // dòng gán đã tắt, cờ tắt

let o: Sql;
let db: Db;
const NOW = new Date("2026-11-08T08:00:00Z");
type Row = { status: string; message: string; value: { count: number } };
let minute = 0;
const round = async (): Promise<Row> => {
  await o`update hub.ops_settings set last_round_at = null where id = 1`;
  await runChecksOnce(
    opsRoundDeps({ db, ops: { checks: [flowFlagCheck], timeoutMs: 5_000 }, log: console as never }),
    new Date(NOW.getTime() + 31 * 60_000 * minute++),
  );
  const [r] = await o<
    Row[]
  >`select status, message, value from hub.ops_checks where check_key = 'flow_flag'`;
  return r as Row;
};

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 4);
  await o`insert into admin.tenants (id, key, name) values (${MISSING}, 't2301', 'Thiếu cờ'), (${OFF}, 't2302', 'Cờ tắt'),
    (${OK}, 't2303', 'Đủ'), (${NONE}, 't2304', 'Không gán'), (${DISABLED}, 't2305', 'Gán đã tắt')`;
  const [d] = await o<
    { id: string }[]
  >`insert into hub.process_defs (tenant_id, key, name, stages, published_version)
    values (null, 'ff-lib', 'ff-lib', '[]'::jsonb, 1) returning id::text as id`;
  const flow = d?.id as string;
  await o`insert into hub.company_flows (tenant_id, flow_id, enabled) values (${MISSING}, ${flow}, true), (${OFF}, ${flow}, true),
    (${OK}, ${flow}, true), (${DISABLED}, ${flow}, false)`;
  await o`insert into hub.tenant_flow_settings (tenant_id, flow_triggers) values (${OFF}, false), (${OK}, true), (${NONE}, false), (${DISABLED}, false)`;
}, 120_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-125 · G8 · ops check flow_flag", () => {
  it("gán bật mà cờ tắt/vắng ⇒ warn nêu đúng 2 công ty, bật cờ ⇒ ok", async () => {
    const bad = await round();
    expect([bad.status, bad.value.count]).toEqual(["warn", 2]);
    expect(bad.message).toContain("Thiếu cờ");
    expect(bad.message).toContain("Cờ tắt");
    expect(bad.message).not.toContain("Không gán");
    expect(bad.message).not.toContain("Gán đã tắt");
    await o`update hub.tenant_flow_settings set flow_triggers = true where tenant_id = ${OFF}`;
    await o`insert into hub.tenant_flow_settings (tenant_id, flow_triggers) values (${MISSING}, true)`;
    expect([(await round()).status, (await round()).value.count]).toEqual(["ok", 0]);
  });
});
