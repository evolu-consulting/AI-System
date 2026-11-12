// CR-127 Z3d-2: khe thường còn sống `contracts.intake` thay khe duyệt HĐ cũ; ca "luật trỏ def đã xoá / bản riêng công ty khác / còn lượt duyệt mà hết luật"
// (CR-121 D-4, c9b) chỉ kiểm khe duyệt cũ đã gỡ ⇒ xoá. CR-120 (part F) · int (DB test, role hub_api, scope system): check `flow_coverage` chạy một lượt ops-watch THẬT.
// Tenant bật gói chạy bằng mẫu khe mà tập gán rỗng (đúng ca Demo) ⇒ crit kèm tên tenant + khe; tenant đã có `process_tenant_defs`
// ⇒ không bị nêu; sau `ensureSlotDefaults` (cr120-single-source) ⇒ ok. Tenant không bật gói không bị kiểm.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { enablePack, tenantId } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { connectDb, type Db } from "../../lib/db";
import { intakeSlotSpec } from "../packs/contracts/testing";
import { ensureSlotDefaults } from "../processes/library/slot-defaults";
import { INTAKE_DEFAULT_ID, reviveIntakeDefault } from "../processes/library/slot-generic.fixture";
import { makeFlowCoverageCheck } from "./adapters/checks/flow-coverage.check";
import { runChecksOnce } from "./application/ops.round";
import { opsRoundDeps } from "./ops.mount";

const SLOT = intakeSlotSpec.key; // CR-127 Z3d-2: khe thường còn sống thay khe duyệt HĐ cũ
const DFLT = INTAKE_DEFAULT_ID;
const DEMO = tenantId(1201); // chỉ gán cũ
const GOOD = tenantId(1202); // đã có process_tenant_defs
const DEAD = tenantId(1203); // process_tenant_defs trỏ def đã xoá mềm
const OFF = tenantId(1204); // không bật gói

let o: Sql;
let db: Db;
const NOW = new Date("2026-11-05T08:00:00Z");
const deps = () =>
  opsRoundDeps({
    db,
    ops: { checks: [makeFlowCoverageCheck(() => [intakeSlotSpec])], timeoutMs: 5_000 },
    log: console as never,
  });
const row = async () =>
  (
    await o<{ status: string; message: string; value: { gap_count: number; checked: number } }[]>`
      select status, message, value from hub.ops_checks where check_key = 'flow_coverage'`
  )[0];
const round = async (min: number) => {
  await o`update hub.ops_settings set last_round_at = null where id = 1`;
  await runChecksOnce(deps(), new Date(NOW.getTime() + min * 60_000));
};

async function deadDef(): Promise<string> {
  const [r] = await o<
    { id: string }[]
  >`insert into hub.process_defs (tenant_id, key, name, description, input_hint,
      run_group_ids, stages, token_budget, enabled, sources, inputs, slot, slot_body, published_version, deleted_at)
    select null, 'cov-dead', 'QT đã xoá', description, input_hint, run_group_ids, stages, token_budget, enabled, sources,
      inputs, slot, slot_body, 1, now() from hub.process_defs where id = ${DFLT} returning id::text as id`;
  return r?.id as string;
}

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  await reviveIntakeDefault(o);
  db = connectDb(urls().hubApi, 4);
  await o`insert into admin.tenants (id, key, name) values (${DEMO}, 't1201', 'Demo'), (${GOOD}, 't1202', 'Tốt'),
    (${DEAD}, 't1203', 'Mồ côi'), (${OFF}, 't1204', 'Không gói')`;
  await enablePack(o, [DEMO, GOOD, DEAD], "contracts");
  await o`insert into hub.process_slots (slot, default_def_id) values (${SLOT}, ${DFLT})
    on conflict (slot) do update set default_def_id = excluded.default_def_id`;
  // cr120-single-source · Demo: chưa có gì trong tập (gán cũ nay là VIEW chỉ đọc), chạy được nhờ mẫu khe.
  await o`insert into hub.process_tenant_defs (tenant_id, def_id, slot) values (${GOOD}, ${DFLT}, ${SLOT})`;
  await o`insert into hub.process_tenant_defs (tenant_id, def_id, slot) values (${DEAD}, ${await deadDef()}, ${SLOT})`;
}, 120_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("ops-watch · flow_coverage · int", () => {
  it("tenant chỉ có gán cũ (Demo) và tenant có def đã xoá ⇒ crit nêu tên + khe, tenant tốt và tenant không bật gói không bị nêu", async () => {
    await round(0);
    const r = await row();
    expect(r?.status).toBe("crit");
    expect(r?.message).toContain(`Demo (${SLOT})`);
    expect(r?.message).toContain(`Mồ côi (${SLOT})`);
    expect(r?.message).not.toContain("Tốt");
    expect(r?.message).not.toContain("Không gói");
    expect(r?.value.checked).toBe(3);
    expect(r?.value.gap_count).toBe(2);
  });

  it("sau ensureSlotDefaults (cấp mẫu khe cho tenant bật app) và gán lại def sống ⇒ ok", async () => {
    expect(await ensureSlotDefaults(db, [{ slot: SLOT, feature: "contracts-read" }], [DEMO])).toBe(
      1,
    );
    await o`delete from hub.process_tenant_defs where tenant_id = ${DEAD}`;
    await o`insert into hub.process_tenant_defs (tenant_id, def_id, slot) values (${DEAD}, ${DFLT}, ${SLOT})`;
    await round(31);
    const r = await row();
    expect(r?.status).toBe("ok");
    expect(r?.value.gap_count).toBe(0);
  });

  it("CR-121 c18 · feature thiếu app (khoá thuộc ứng dụng mà cột app = other) ⇒ crit nêu key, sửa xong ⇒ ok", async () => {
    await o`insert into admin.features (key, name, app) values ('contracts-c18bad', '{"vi":"x"}'::jsonb, 'other')`;
    await round(62);
    const r = await row();
    expect(r?.status).toBe("crit");
    expect(r?.message).toContain("contracts-c18bad");
    await o`delete from admin.features where key = 'contracts-c18bad'`;
    await round(93);
    expect((await row())?.status).toBe("ok");
  });
});
