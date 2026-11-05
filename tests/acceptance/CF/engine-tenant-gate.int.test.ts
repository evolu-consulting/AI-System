// CR-121 D-4 · env CONTRACTS_APPROVAL_ENGINE=on + cổng theo công ty = ĐÃ GÁN quy trình cho khe duyệt HĐ (không còn feature
// `contracts-approval-engine`): công ty chưa gán ⇒ lượt level1 chạy máy 2 bước cũ; gán ⇒ lượt MỚI chạy engine, KHÔNG cần bật gì khác;
// bỏ gán ⇒ HĐ mới lại về máy cũ, lượt đã engine chạy nốt. Cổng đọc luật định tuyến (nguồn duy nhất), không đọc feature/entitlement.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  APPROVAL_SLOT,
  compileSlotStages,
} from "../../../apps/hub-api/src/modules/packs/contracts/domain/approval-slot.rules";
import { groupId, seedContract, toLevel1 } from "../HD3/_hd3";
import { type Json, T } from "../P-d/_support/pd";
import { type CtxCf, startCf } from "./_cf";

let c: CtxCf;
beforeAll(async () => {
  c = await startCf({}, { contractsAi: { approvalEngineTenantGate: true } });
}, 180_000);
afterAll(async () => {
  await c?.stop();
});

const modeOf = async (aid: string): Promise<unknown> =>
  ((await c.sql<Json[]>`select mode from contracts.approvals where id = ${aid}`)[0] as Json).mode;

/** Gán quy trình riêng cho khe duyệt HĐ của công ty (đúng đường Admin: tập gán + đầu luật + luật mặc định trỏ def riêng). */
async function assign(): Promise<void> {
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
    values (null, 'cf-d4-assign', 'Quy trình riêng', ${JSON.stringify(stages)}::text::jsonb, ${APPROVAL_SLOT},
      ${JSON.stringify(body)}::text::jsonb, 1) returning id::text as id`;
  const id = d?.id as string;
  await c.sql`insert into hub.process_def_releases (def_id, rel_version, name, stages, slot_body)
    values (${id}, 1, 'Quy trình riêng', ${JSON.stringify(stages)}::text::jsonb, ${JSON.stringify(body)}::text::jsonb)`;
  await c.sql`insert into hub.process_tenant_defs (tenant_id, def_id, slot) values (${T.acme}, ${id}, ${APPROVAL_SLOT}) on conflict do nothing`;
  await c.sql`insert into hub.process_routings (tenant_id, slot) values (${T.acme}, ${APPROVAL_SLOT}) on conflict do nothing`;
  await c.sql`insert into hub.process_routing_rules (tenant_id, slot, priority, condition, def_id, is_default)
    values (${T.acme}, ${APPROVAL_SLOT}, 10, '{}'::jsonb, ${id}, false)`;
}

describe("CR-121 D-4 · gán quy trình ⇒ engine (không cần feature)", () => {
  it("chưa gán ⇒ máy cũ, gán ⇒ engine (không có feature/entitlement nào), bỏ gán ⇒ máy cũ", async () => {
    // Công ty KHÔNG có entitlement `contracts-approval-engine` ở bất kỳ bước nào của test.
    const noEntitlement = async () =>
      (
        await c.sql`select 1 from admin.feature_entitlements e join admin.features f on f.id = e.feature_id
          where e.tenant_id = ${T.acme} and f.key = 'contracts-approval-engine' and e.revoked_at is null`
      ).length;
    expect(await noEntitlement()).toBe(0);

    const a = await toLevel1(c, await seedContract(c, 721), 10_000_000);
    expect(await modeOf(a.runId)).toBe("machine");

    await assign();
    const b = await toLevel1(c, await seedContract(c, 722), 10_000_000);
    expect(await modeOf(b.runId)).toBe("engine");

    await c.sql`delete from hub.process_routing_rules where tenant_id = ${T.acme} and slot = ${APPROVAL_SLOT}`;
    const d = await toLevel1(c, await seedContract(c, 723), 10_000_000);
    expect(await modeOf(d.runId)).toBe("machine");
    // Lượt đã chạy engine không bị cắt giữa chừng.
    expect(await modeOf(b.runId)).toBe("engine");
    expect(await noEntitlement()).toBe(0);
  }, 90_000);
});
