// CR-120 (part F) · int (DB test, role hub_api, scope system): check `flow_coverage` chạy một lượt ops-watch THẬT.
// Tenant bật gói mà việc gán chỉ nằm ở bảng cũ `process_slot_assignments` (đúng ca Demo) ⇒ crit kèm tên tenant + khe; tenant đã có
// `process_tenant_defs` ⇒ không bị nêu; sau khi chép sang bảng mới (backfill) ⇒ ok. Tenant không bật gói không bị kiểm.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { enablePack, tenantId } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { connectDb, type Db } from "../../lib/db";
import { approvalSlotSpec } from "../packs/contracts/approval.mount";
import { APPROVAL_DEFAULT_DEF } from "../packs/contracts/domain/approval-slot-default.rules";
import { makeFlowCoverageCheck } from "./adapters/checks/flow-coverage.check";
import { runChecksOnce } from "./application/ops.round";
import { opsRoundDeps } from "./ops.mount";

const SLOT = approvalSlotSpec.key;
const DFLT = APPROVAL_DEFAULT_DEF.id;
const DEMO = tenantId(1201); // chỉ gán cũ
const GOOD = tenantId(1202); // đã có process_tenant_defs
const DEAD = tenantId(1203); // process_tenant_defs trỏ def đã xoá mềm
const OFF = tenantId(1204); // không bật gói
const RULE = tenantId(1205); // chỉ có luật định tuyến, thiếu feature engine
const NOENG = tenantId(1206); // có quy trình gán, thiếu feature engine

let o: Sql;
let db: Db;
const NOW = new Date("2026-11-05T08:00:00Z");
const deps = () =>
  opsRoundDeps({
    db,
    ops: { checks: [makeFlowCoverageCheck(() => [approvalSlotSpec])], timeoutMs: 5_000 },
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
  db = connectDb(urls().hubApi, 4);
  await o`insert into admin.tenants (id, key, name) values (${DEMO}, 't1201', 'Demo'), (${GOOD}, 't1202', 'Tốt'),
    (${DEAD}, 't1203', 'Mồ côi'), (${OFF}, 't1204', 'Không gói')`;
  await enablePack(o, [DEMO, GOOD, DEAD], "contracts");
  await o`insert into admin.features (key, name, description, icon, status)
    values ('contracts-approval-engine', '{"vi":"Duyệt HĐ bằng quy trình"}'::jsonb, '{"vi":"x"}'::jsonb, 'workflow', 'on')
    on conflict (key) do nothing`;
  await o`insert into admin.feature_entitlements (feature_id, tenant_id)
    select f.id, t from admin.features f, unnest(${[DEMO, GOOD, DEAD]}::uuid[]) t where f.key = 'contracts-approval-engine'
    on conflict do nothing`;
  await o`insert into hub.process_slots (slot, default_def_id) values (${SLOT}, ${DFLT})
    on conflict (slot) do update set default_def_id = excluded.default_def_id`;
  await o`insert into hub.process_slot_assignments (tenant_id, slot, def_id) values (${DEMO}, ${SLOT}, ${DFLT})`;
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

  it("sau backfill (chép gán cũ sang process_tenant_defs) và gán lại def sống ⇒ ok", async () => {
    await o`insert into hub.process_tenant_defs (tenant_id, def_id, slot)
      select tenant_id, def_id, slot from hub.process_slot_assignments on conflict (tenant_id, def_id) do nothing`;
    await o`delete from hub.process_tenant_defs where tenant_id = ${DEAD}`;
    await o`insert into hub.process_tenant_defs (tenant_id, def_id, slot) values (${DEAD}, ${DFLT}, ${SLOT})`;
    await round(31);
    const r = await row();
    expect(r?.status).toBe("ok");
    expect(r?.value.gap_count).toBe(0);
  });

  it("tenant có luật/quy trình contracts.approval nhưng thiếu feature contracts-approval-engine ⇒ crit nêu tên, cấp feature ⇒ ok", async () => {
    await o`insert into admin.tenants (id, key, name) values (${RULE}, 't1205', 'Chỉ luật')`;
    await o`insert into admin.tenants (id, key, name) values (${NOENG}, 't1206', 'Thiếu engine')`;
    await o`insert into hub.process_tenant_defs (tenant_id, def_id, slot) values (${RULE}, ${DFLT}, ${SLOT})`;
    await o`insert into hub.process_routings (tenant_id, slot) values (${RULE}, ${SLOT})`;
    await o`insert into hub.process_routing_rules (tenant_id, slot, priority, condition, def_id, is_default)
      values (${RULE}, ${SLOT}, 0, '{}'::jsonb, ${DFLT}, true)`;
    await o`insert into hub.process_tenant_defs (tenant_id, def_id, slot) values (${NOENG}, ${DFLT}, ${SLOT})`;
    await round(62);
    const r = await row();
    expect(r?.status).toBe("crit");
    expect(r?.message).toContain("contracts-approval-engine");
    expect(r?.message).toContain("Chỉ luật");
    expect(r?.message).toContain("Thiếu engine");
    expect(r?.message).not.toContain("Demo");
    await o`insert into admin.feature_entitlements (feature_id, tenant_id)
      select f.id, t from admin.features f, unnest(${[RULE, NOENG]}::uuid[]) t where f.key = 'contracts-approval-engine'`;
    await round(93);
    expect((await row())?.status).toBe("ok");
  });
});
