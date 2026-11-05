// cr121-a2 · duyệt HĐ CHỈ trên engine (thay `approval-engine-off` + `engine-tenant-gate`): không env, không cổng "đã gán".
// (1) công ty chưa gán (không luật nào — `ensureSlotDefaults` chưa chạy) ⇒ lượt MỚI chạy engine với quy trình MẶC ĐỊNH của khe;
// (2) đã gán ⇒ quy trình gán; (3) lượt máy cũ đang dở (mode='machine', chưa run) vẫn quyết xong qua đường decide cũ, không tạo run
// engine, không chuyển giữa chừng; (4) mở lượt 2 lần đồng thời ⇒ đúng 1 lượt, 1 run.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  APPROVAL_SLOT,
  compileSlotStages,
} from "../../../apps/hub-api/src/modules/packs/contracts/domain/approval-slot.rules";
import {
  act,
  agentJson,
  CBASE,
  contractRow,
  groupId,
  seedContract,
  toLevel1,
  total,
} from "../HD3/_hd3";
import { type Json, PA, T } from "../P-d/_support/pd";
import { type CtxCf, startCf } from "./_cf";

let c: CtxCf;
beforeAll(async () => {
  c = await startCf();
  // Công ty chưa có luật nào cho khe duyệt HĐ (như tenant mới trước lượt `ensureSlotDefaults`).
  await c.sql`delete from hub.process_routing_rules where tenant_id = ${T.acme} and slot = ${APPROVAL_SLOT}`;
}, 180_000);
afterAll(async () => {
  await c?.stop();
});

const rowOf = async (aid: string): Promise<Json> =>
  (
    await c.sql<Json[]>`select status, mode, engine_run_id::text as run, feedback,
      coalesce(flow_steps::text, '') as steps from contracts.approvals where id = ${aid}`
  )[0] as Json;
const runsOf = async (id: string): Promise<number> =>
  (
    await c.sql<{ n: number }[]>`select count(*)::int as n from hub.process_runs
      where pack_key = 'contracts' and pack_record_id = ${id}`
  )[0]?.n ?? -1;
const machineCount = async (): Promise<number> =>
  (
    await c.sql<{ n: number }[]>`select count(*)::int as n from contracts.approvals
      where tenant_id = ${T.acme} and mode = 'machine' and engine_run_id is null
        and status in ('level1', 'level2')`
  )[0]?.n ?? -1;

/** Gán quy trình riêng cho khe duyệt HĐ (đúng đường Admin: tập gán + đầu luật + luật trỏ def riêng). */
async function assign(): Promise<void> {
  const [kO] = await c.sql<
    { key: string }[]
  >`select key from admin.groups where id = ${await groupId(c, "owner")}`;
  const body = {
    steps: [
      {
        kind: "review",
        key: "kt",
        name: "Kế toán duyệt A2",
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
    values (null, 'cf-a2-assign', 'Quy trình riêng', ${JSON.stringify(stages)}::text::jsonb, ${APPROVAL_SLOT},
      ${JSON.stringify(body)}::text::jsonb, 1) returning id::text as id`;
  const id = d?.id as string;
  await c.sql`insert into hub.process_def_releases (def_id, rel_version, name, stages, slot_body)
    values (${id}, 1, 'Quy trình riêng', ${JSON.stringify(stages)}::text::jsonb, ${JSON.stringify(body)}::text::jsonb)`;
  await c.sql`insert into hub.process_tenant_defs (tenant_id, def_id, slot) values (${T.acme}, ${id}, ${APPROVAL_SLOT}) on conflict do nothing`;
  await c.sql`insert into hub.process_routings (tenant_id, slot) values (${T.acme}, ${APPROVAL_SLOT}) on conflict do nothing`;
  await c.sql`insert into hub.process_routing_rules (tenant_id, slot, priority, condition, def_id, is_default)
    values (${T.acme}, ${APPROVAL_SLOT}, 10, '{}'::jsonb, ${id}, false)`;
}

describe("cr121-a2 · lượt mới luôn engine", () => {
  it("chưa gán (không luật) ⇒ engine với quy trình mặc định của khe, gán ⇒ quy trình gán, không lượt máy cũ mới", async () => {
    const before = await machineCount();
    const a = await toLevel1(c, await seedContract(c, 721), 10_000_000);
    const ra = await rowOf(a.runId);
    expect({ mode: ra.mode, run: typeof ra.run, feedback: ra.feedback }).toEqual({
      mode: "engine",
      run: "string",
      feedback: null,
    });
    expect(String(ra.steps).length).toBeGreaterThan(2);
    expect(String(ra.steps)).not.toContain("Kế toán duyệt A2");

    await assign();
    const b = await toLevel1(c, await seedContract(c, 722), 10_000_000);
    const rb = await rowOf(b.runId);
    expect({ mode: rb.mode, run: typeof rb.run }).toEqual({ mode: "engine", run: "string" });
    expect(String(rb.steps)).toContain("Kế toán duyệt A2");
    // Lượt mở trước khi gán vẫn chạy quy trình cũ của nó (không chuyển giữa chừng).
    expect((await rowOf(a.runId)).run).toBe(ra.run);
    expect(await machineCount()).toBe(before);
  }, 90_000);

  it("lượt máy cũ đang dở ⇒ quyết xong qua decide cũ (cấp 1 → cấp 2 → Đã duyệt), không mở run engine", async () => {
    const id = await seedContract(c, 723, { status: "needs_review" });
    const aid = crypto.randomUUID();
    await c.sql`insert into contracts.approvals (id, tenant_id, contract_id, status, started_by)
      values (${aid}, ${T.acme}, ${id}, 'level1', ${PA.A.id})`;
    await c.sql`update contracts.contracts set run_id = ${aid} where id = ${id}`;
    expect((await rowOf(aid)).mode).toBe("machine");

    const r1 = await act(c, "B", id, "approve");
    expect(r1.status).toBe(200);
    const mid = await rowOf(aid);
    expect({ mode: mid.mode, run: mid.run }).toEqual({ mode: "machine", run: null });
    if (mid.status === "level2") expect((await act(c, "H", id, "approve")).status).toBe(200);
    expect((await contractRow(c, id)).status).toBe("active");
    const end = await rowOf(aid);
    expect({ mode: end.mode, run: end.run, status: end.status }).toEqual({
      mode: "machine",
      run: null,
      status: "done",
    });
    expect(await runsOf(id)).toBe(0);
  }, 60_000);

  it("đua · mở lượt 2 lần đồng thời ⇒ đúng 1 lượt duyệt, 1 run engine", async () => {
    const id = await seedContract(c, 724);
    c.model.reply = { ok: true, text: agentJson(total(10_000_000)) };
    const done = c.extracted(id);
    const rs = await Promise.all([
      c.call("A", "POST", `${CBASE}/${id}/extract`),
      c.call("A", "POST", `${CBASE}/${id}/extract`),
    ]);
    expect(rs.filter((r) => r.status === 202).length).toBe(1);
    expect(await done).toBe("needs_review");
    const all = await c.sql<Json[]>`select mode, engine_run_id::text as run from contracts.approvals
      where contract_id = ${id}`;
    expect(all.length).toBe(1);
    expect({ mode: all[0]?.mode, run: typeof all[0]?.run }).toEqual({
      mode: "engine",
      run: "string",
    });
    expect(await runsOf(id)).toBe(1);
  }, 60_000);
});
