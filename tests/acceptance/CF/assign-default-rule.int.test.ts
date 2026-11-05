// CR-121 F-1 · gán quy trình ở admin-web (API "Gán quy trình": PUT /tenants/:tid/process-routing/:slot/processes/:defId, platform_admin)
// là đủ để engine chạy ĐÚNG quy trình đó: cùng một tx đặt luật mặc định của khe = quy trình vừa gán (source 'admin'), không cần gọi thêm
// "đặt luật mặc định". Gán quy trình khác ⇒ lượt MỚI chạy quy trình khác. Ca phụ: người công ty khác đọc HĐ/lượt duyệt ⇒ 404 (không lộ).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  APPROVAL_SLOT,
  compileSlotStages,
} from "../../../apps/hub-api/src/modules/packs/contracts/domain/approval-slot.rules";
import { CBASE } from "../HD1/_support/hd1";
import { approval, bump, groupId, seedContract, toLevel1 } from "../HD3/_hd3";
import { packGroupKey, packsPath } from "../N1/_support/n1";
import { type Json, PA, T } from "../P-d/_support/pd";
import { type CtxCf, startCf } from "./_cf";

const NAME_A = "F1 Duyệt A";
const NAME_B = "F1 Duyệt B";
const PROC = (defId: string) =>
  `/tenants/${T.acme}/process-routing/${APPROVAL_SLOT}/processes/${defId}`;

let c: CtxCf;
beforeAll(async () => {
  c = await startCf({}, { contractsAi: { approvalEngineTenantGate: true } });
}, 180_000);
afterAll(async () => {
  await c?.stop();
});

const modeOf = async (aid: string): Promise<unknown> =>
  ((await c.sql<Json[]>`select mode from contracts.approvals where id = ${aid}`)[0] as Json).mode;

/** Quy trình thư viện đã xuất bản của khe duyệt HĐ (một bước `stepName`), CHƯA gán cho công ty nào. */
async function libDef(key: string, stepName: string): Promise<string> {
  const [kO] = await c.sql<
    { key: string }[]
  >`select key from admin.groups where id = ${await groupId(c, "owner")}`;
  const body = {
    steps: [
      {
        kind: "review",
        key: "kt",
        name: stepName,
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
    values (null, ${key}, ${stepName}, ${JSON.stringify(stages)}::text::jsonb, ${APPROVAL_SLOT},
      ${JSON.stringify(body)}::text::jsonb, 1) returning id::text as id`;
  const id = d?.id as string;
  await c.sql`insert into hub.process_def_releases (def_id, rel_version, name, stages, slot_body)
    values (${id}, 1, ${stepName}, ${JSON.stringify(stages)}::text::jsonb, ${JSON.stringify(body)}::text::jsonb)`;
  return id;
}

const defaultRule = async () => [
  ...(await c.sql`select def_id::text as d, source as s from hub.process_routing_rules
    where tenant_id = ${T.acme} and slot = ${APPROVAL_SLOT} and is_default`),
];
const stepNames = async (id: string): Promise<string[]> =>
  ((await approval(c, "A", id)).json?.steps ?? []).map((s: Json) => String(s.name));

describe("CR-121 F-1 · gán quy trình ⇒ luật mặc định ⇒ engine chạy đúng quy trình", () => {
  it("gán qua API ⇒ lượt mới chạy engine với quy trình đó, gán quy trình khác ⇒ đổi theo", async () => {
    const [a, b] = [await libDef("cf-f1-a", NAME_A), await libDef("cf-f1-b", NAME_B)];

    // Chưa gán ⇒ máy cũ.
    const before = await toLevel1(c, await seedContract(c, 731), 10_000_000);
    expect(await modeOf(before.runId)).toBe("machine");

    // Gán A: đúng một lời gọi như nút "Gán quy trình" ở admin-web.
    expect((await c.call("P", "PUT", PROC(a))).status).toBe(200);
    expect(await defaultRule()).toEqual([{ d: a, s: "admin" }]);
    const idA = await seedContract(c, 732);
    const first = await toLevel1(c, idA, 10_000_000);
    expect(await modeOf(first.runId)).toBe("engine");
    expect(await stepNames(idA)).toContain(NAME_A);

    // Gán lại quy trình khác ⇒ luật mặc định đổi theo; lượt mới chạy B; lượt cũ chạy nốt A.
    expect((await c.call("P", "PUT", PROC(b))).status).toBe(200);
    expect(await defaultRule()).toEqual([{ d: b, s: "admin" }]);
    const idB = await seedContract(c, 733);
    const second = await toLevel1(c, idB, 10_000_000);
    expect(await modeOf(second.runId)).toBe("engine");
    expect(await stepNames(idB)).toContain(NAME_B);
    expect(await stepNames(idB)).not.toContain(NAME_A);
    expect(await stepNames(idA)).toContain(NAME_A);
  }, 120_000);

  it("người công ty khác đọc HĐ / lượt duyệt của công ty này ⇒ 404 (không lộ tồn tại, không 400)", async () => {
    // Công ty thứ hai bật gói hợp đồng + người dùng có quyền đọc (cùng điều kiện hành trình 2 công ty của D-5).
    const en = await c.admin.call("PUT", packsPath(T.beta, "contracts"));
    expect(en.status).toBe(200);
    const [g] = await c.sql<{ id: string }[]>`select id from admin.groups
      where tenant_id = ${T.beta} and key = ${packGroupKey("contracts", "editor")}`;
    await c.sql`insert into admin.group_members (tenant_id, group_id, user_id)
      values (${T.beta}, ${g?.id as string}, ${PA.Db.id}) on conflict do nothing`;
    await bump(c);
    let me: { status: number; json: Json } = { status: 0, json: {} };
    const end = Date.now() + 8_000;
    while (Date.now() < end) {
      me = await c.call("Db", "GET", "/pack/contracts/me");
      if (me.status === 200 && (me.json?.actions ?? []).includes("read")) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    expect({ s: me.status, read: me.json?.actions?.includes("read") }).toEqual({
      s: 200,
      read: true,
    });

    const id = await seedContract(c, 734);
    const own = await c.call("A", "GET", `${CBASE}/${id}`);
    expect(own.status).toBe(200);
    for (const path of [`${CBASE}/${id}`, `${CBASE}/${id}/approval`]) {
      const r = await c.call("Db", "GET", path);
      expect({ path, status: r.status, code: r.json?.error?.code }).toEqual({
        path,
        status: 404,
        code: "NOT_FOUND",
      });
    }
  }, 60_000);
});
