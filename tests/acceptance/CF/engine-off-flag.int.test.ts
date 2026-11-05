// engine-off-note · `GET /contracts/:id/approval` báo `engine_off: true` khi công ty có quy trình gán/luật (không phải mặc định) mà CHƯA có
// entitlement `contracts-approval-engine` và lượt chạy máy cũ; có entitlement ⇒ vắng. Cổng theo công ty bật như `engine-tenant-gate`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  APPROVAL_SLOT,
  compileSlotStages,
} from "../../../apps/hub-api/src/modules/packs/contracts/domain/approval-slot.rules";
import { CBASE, groupId, seedContract, toLevel1 } from "../HD3/_hd3";
import { bumpConfig } from "../N1/_support/n1";
import { type Json, T } from "../P-d/_support/pd";
import { type CtxCf, startCf } from "./_cf";

let c: CtxCf;
beforeAll(async () => {
  c = await startCf({}, { contractsAi: { approvalEngineTenantGate: true } });
}, 180_000);
afterAll(async () => {
  await c?.stop();
});

/** Một luật chọn quy trình KHÔNG mặc định (điều kiện rỗng) ⇒ công ty "có quy trình riêng". */
async function assignRule(): Promise<void> {
  const [kO] = await c.sql<
    { key: string }[]
  >`select key from admin.groups where id = ${await groupId(c, "owner")}`;
  const body = {
    steps: [
      {
        kind: "review",
        key: "kt",
        name: "Kế toán duyệt",
        department_group_id: null,
        department_group_key: kO?.key,
        head_only: false,
        due_h: 48,
        remind_every_h: null,
        escalate_group_id: null,
        exclude_starter: false,
        when: null,
      },
    ],
  };
  const stages = compileSlotStages(body);
  const [d] = await c.sql<
    { id: string }[]
  >`insert into hub.process_defs (tenant_id, key, name, stages, slot, slot_body, published_version)
    values (null, 'cf-engine-off', 'Quy trình riêng', ${JSON.stringify(stages)}::text::jsonb, ${APPROVAL_SLOT},
      ${JSON.stringify(body)}::text::jsonb, 1) returning id::text as id`;
  const id = d?.id as string;
  await c.sql`insert into hub.process_def_releases (def_id, rel_version, name, stages, slot_body)
    values (${id}, 1, 'Quy trình riêng', ${JSON.stringify(stages)}::text::jsonb, ${JSON.stringify(body)}::text::jsonb)`;
  await c.sql`insert into hub.process_tenant_defs (tenant_id, def_id, slot) values (${T.acme}, ${id}, ${APPROVAL_SLOT}) on conflict do nothing`;
  await c.sql`insert into hub.process_routings (tenant_id, slot) values (${T.acme}, ${APPROVAL_SLOT}) on conflict do nothing`;
  await c.sql`insert into hub.process_routing_rules (tenant_id, slot, priority, condition, def_id, is_default)
    values (${T.acme}, ${APPROVAL_SLOT}, 10, '{}'::jsonb, ${id}, false)`;
  await c.sql`update hub.config_meta set hub_config_version = hub_config_version + 1 where id = 1`;
}

const card = async (id: string): Promise<Json> =>
  (await c.call("A", "GET", `${CBASE}/${id}/approval`)).json as Json;

describe("engine-off-note · cờ engine_off trên thẻ duyệt", () => {
  it("có luật chọn quy trình + chưa entitlement ⇒ engine_off true; cấp entitlement ⇒ vắng", async () => {
    await assignRule();
    const id = await seedContract(c, 751);
    await toLevel1(c, id, 10_000_000);
    const off = await card(id);
    expect(off.engine_off).toBe(true);

    await c.sql`insert into admin.features (key, name, description, icon, status)
      values ('contracts-approval-engine', '{"vi":"x"}'::jsonb, '{"vi":"x"}'::jsonb, 'workflow', 'on') on conflict (key) do nothing`;
    await c.sql`insert into admin.feature_entitlements (feature_id, tenant_id)
      select id, ${T.acme} from admin.features where key = 'contracts-approval-engine'
      on conflict (feature_id, tenant_id) do update set revoked_at = null`;
    await bumpConfig(c.sql, T.acme);
    expect((await card(id)).engine_off).toBeUndefined();
  }, 120_000);
});
