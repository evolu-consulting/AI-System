// CR-120 (part F) · int (DB test, role hub_api, scope system): check `flow_coverage` chạy một lượt ops-watch THẬT.
// Tenant bật gói chạy bằng mẫu khe mà tập gán rỗng (đúng ca Demo) ⇒ crit kèm tên tenant + khe; tenant đã có `process_tenant_defs`
// ⇒ không bị nêu; sau `ensureSlotDefaults` (cr120-single-source) ⇒ ok. Tenant không bật gói không bị kiểm.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { enablePack, tenantId } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { connectDb, type Db } from "../../lib/db";
import { approvalSlotSpec } from "../packs/contracts/approval.mount";
import { APPROVAL_DEFAULT_DEF } from "../packs/contracts/domain/approval-slot-default.rules";
import { ensureSlotDefaults } from "../processes/library/slot-defaults";
import { makeFlowCoverageCheck } from "./adapters/checks/flow-coverage.check";
import { runChecksOnce } from "./application/ops.round";
import { opsRoundDeps } from "./ops.mount";

const SLOT = approvalSlotSpec.key;
const DFLT = APPROVAL_DEFAULT_DEF.id;
const DEMO = tenantId(1201); // chỉ gán cũ
const GOOD = tenantId(1202); // đã có process_tenant_defs
const DEAD = tenantId(1203); // process_tenant_defs trỏ def đã xoá mềm
const OFF = tenantId(1204); // không bật gói
const RULE = tenantId(1205); // CR-121 D-4 · luật trỏ quy trình đã xoá
const LAC = tenantId(1207); // CR-121 c9b · luật trỏ BẢN RIÊNG của công ty khác
const NOENG = tenantId(1206); // CR-121 D-4 · còn run duyệt đang chạy mà hết luật

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

  it("CR-121 c18 · feature thiếu app (khoá thuộc ứng dụng mà cột app = other) và engine còn sót ⇒ crit nêu key, sửa xong ⇒ ok", async () => {
    await o`insert into admin.features (key, name, app) values ('contracts-c18bad', '{"vi":"x"}'::jsonb, 'other'),
      ('contracts-approval-engine', '{"vi":"e"}'::jsonb, 'contracts')`;
    await round(62);
    const r = await row();
    expect(r?.status).toBe("crit");
    expect(r?.message).toContain("contracts-c18bad");
    expect(r?.message).toContain("contracts-approval-engine");
    await o`delete from admin.features where key in ('contracts-c18bad', 'contracts-approval-engine')`;
    await round(93);
    expect((await row())?.status).toBe("ok");
  });

  it("CR-121 D-4 · luật trỏ quy trình đã xoá / còn lượt duyệt mà hết luật ⇒ crit nêu tên (không nhắc feature), sửa ⇒ ok", async () => {
    await o`insert into admin.tenants (id, key, name) values (${RULE}, 't1205', 'Luật hỏng')`;
    await o`insert into admin.tenants (id, key, name) values (${NOENG}, 't1206', 'Mất gán')`;
    // RULE: luật mặc định trỏ def đã xoá mềm ⇒ HĐ mới bị chặn (route_unavailable).
    const dead = await deadDef();
    await o`insert into hub.process_tenant_defs (tenant_id, def_id, slot) values (${RULE}, ${dead}, ${SLOT})`;
    await o`insert into hub.process_routings (tenant_id, slot) values (${RULE}, ${SLOT})`;
    await o`insert into hub.process_routing_rules (tenant_id, slot, priority, condition, def_id, is_default)
      values (${RULE}, ${SLOT}, 0, '{}'::jsonb, ${dead}, true)`;
    // NOENG: còn run duyệt HĐ đang chạy trên def tenant `contracts-approval` nhưng khe không có luật nào.
    await o`insert into hub.process_tenant_defs (tenant_id, def_id, slot) values (${NOENG}, ${DFLT}, ${SLOT})`;
    const [tdef] = await o<
      { id: string }[]
    >`insert into hub.process_defs (tenant_id, key, name, description, input_hint,
        run_group_ids, stages, token_budget, enabled, sources, inputs, source_ref, version)
      select ${NOENG}, 'contracts-approval', name, description, input_hint, run_group_ids, stages, token_budget, enabled,
        sources, inputs, '0123456789abcdef', 1 from hub.process_defs where id = ${DFLT} returning id::text as id`;
    const [u] = await o<
      { id: string }[]
    >`insert into admin.users (tenant_id, username, email, password_hash,
        display_name, role, locale, must_change_password)
      values (${NOENG}, 'cov-user', 'cov-user@example.invalid', 'x', 'cov-user', 'member', 'vi', false) returning id::text as id`;
    const [cv] = await o<
      { id: string }[]
    >`insert into hub.conversations (tenant_id, user_id, title, title_norm)
      values (${NOENG}, ${u?.id as string}, 'c', 'c') returning id::text as id`;
    await o`insert into hub.process_runs (tenant_id, process_def_id, def_version, snapshot, started_by, origin_kind,
        input, conversation_id, flow_id, expires_at)
      values (${NOENG}, ${tdef?.id as string}, 1, '{}'::jsonb, ${u?.id as string}, 'admin', 'x', ${cv?.id as string},
        gen_random_uuid(), now() + interval '1 day')`;
    await round(124);
    const r = await row();
    expect(r?.status).toBe("crit");
    expect(r?.message).toContain("Luật hỏng");
    expect(r?.message).toContain("Mất gán");
    expect(r?.message).not.toContain("contracts-approval-engine");
    expect(r?.message).not.toContain("Demo");
    // Sửa: luật trỏ def sống; run kết thúc ⇒ ok.
    await o`insert into hub.process_tenant_defs (tenant_id, def_id, slot) values (${RULE}, ${DFLT}, ${SLOT}) on conflict do nothing`;
    await o`update hub.process_routing_rules set def_id = ${DFLT} where tenant_id = ${RULE}`;
    await o`delete from hub.process_runs where tenant_id = ${NOENG}`;
    await round(155);
    expect((await row())?.status).toBe("ok");
  });

  it("CR-121 c9b · luật trỏ bản riêng của công ty KHÁC ⇒ crit nêu tên; trỏ lại def sống ⇒ ok", async () => {
    await o`insert into admin.tenants (id, key, name) values (${LAC}, 't1207', 'Lạc luật')`;
    const [priv] = await o<
      { id: string }[]
    >`insert into hub.process_defs (tenant_id, key, name, stages,
        source_template_id, source_rel_version)
      select ${GOOD}, 'cov-priv', 'Bản riêng Tốt', stages, ${DFLT}, 1 from hub.process_defs where id = ${DFLT} returning id::text as id`;
    const pid = priv?.id as string;
    await o`insert into hub.process_tenant_defs (tenant_id, def_id, slot) values (${LAC}, ${pid}, ${SLOT})`;
    await o`insert into hub.process_routings (tenant_id, slot) values (${LAC}, ${SLOT})`;
    await o`insert into hub.process_routing_rules (tenant_id, slot, priority, condition, def_id, is_default)
      values (${LAC}, ${SLOT}, 0, '{}'::jsonb, ${pid}, true)`;
    await round(186);
    const bad = await row();
    expect(bad?.status).toBe("crit");
    expect(bad?.message).toContain("Lạc luật");
    // bản riêng của CHÍNH công ty (GOOD) trỏ luật của GOOD thì không báo hỏng
    expect(bad?.message).not.toContain("Tốt");
    await o`insert into hub.process_tenant_defs (tenant_id, def_id, slot) values (${LAC}, ${DFLT}, ${SLOT}) on conflict do nothing`;
    await o`update hub.process_routing_rules set def_id = ${DFLT} where tenant_id = ${LAC}`;
    await round(217);
    expect((await row())?.status).toBe("ok");
  });
});
