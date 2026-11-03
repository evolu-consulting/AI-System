// CR-113 · hub THẬT, cờ engine bật: (1) chủ gói (Toàn quyền, KHÔNG thuộc Group cấp 1) Đạt bước 1 ⇒ ghi "duyệt thay"
// (`contract_events` `approval_override`) + thẻ `decided_as = owner_override`; người của bước Đạt ⇒ `member`, không ghi.
// (2) bước có hạn, không đặt nhóm chuyển cấp ⇒ def biên dịch chuyển cấp về Group Toàn quyền; quá hạn (đặt `escalate_at` về quá khứ,
// không ngủ) + một lượt `remindOnce` ⇒ chuyển cấp tới Toàn quyền, thẻ `overdue` + `escalated_to`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  act,
  agentJson,
  approval,
  CBASE,
  contractRow,
  errCode,
  groupId,
  seedContract,
  total,
} from "../HD3/_hd3";
import { type Json, PA, type Role, remind, waitStatus } from "../P-d/_support/pd";
import { type CtxCf, startCf } from "./_cf";

let c: CtxCf;
beforeAll(async () => {
  c = await startCf();
}, 180_000);
afterAll(async () => {
  await c?.stop();
});

async function openBy(who: Role, n: number, v: number): Promise<{ id: string; run: string }> {
  const id = await seedContract(c, n, { createdBy: PA[who].id, owner: PA[who].id });
  c.model.reply = { ok: true, text: agentJson(total(v)) };
  const done = c.extracted(id);
  const r = await c.call(who, "POST", `${CBASE}/${id}/extract`);
  expect({ status: r.status, code: errCode(r) }).toEqual({ status: 202, code: null });
  expect(await done).toBe("needs_review");
  const [a] = await c.sql<Json[]>`select a.engine_run_id::text as run
    from contracts.approvals a join contracts.contracts k on k.run_id = a.id where k.id = ${id}`;
  await waitStatus(c.sql, a?.run as string, "waiting_review");
  return { id, run: a?.run as string };
}
const card = async (r: Role, id: string) => (await approval(c, r, id)).json as Json;
const overrides = (id: string) =>
  c.sql<
    Json[]
  >`select actor_user_id::text as actor, data->>'stage' as stage, data->>'action' as action
    from contracts.contract_events where contract_id = ${id} and type = 'approval_override'`;

describe("CR-113 · chủ gói duyệt thay + chuyển cấp mặc định", () => {
  it("H (Toàn quyền, ngoài Group cấp 1) Đạt ⇒ owner_override được ghi, B (người của bước) Đạt ⇒ member", async () => {
    const h = await openBy("B", 791, 10_000_000);
    expect((await act(c, "H", h.id, "approve")).status).toBe(200);
    await waitStatus(c.sql, h.run, "done");
    expect(await contractRow(c, h.id)).toMatchObject({ status: "active", confirmed_by: PA.H.id });
    expect(await overrides(h.id)).toEqual([{ actor: PA.H.id, stage: "s0", action: "approve" }]);
    expect((await card("A", h.id)).steps?.[0]?.decided_as).toBe("owner_override");

    const b = await openBy("A", 792, 10_000_000);
    expect((await act(c, "B", b.id, "approve")).status).toBe(200);
    await waitStatus(c.sql, b.run, "done");
    expect(await overrides(b.id)).toEqual([]);
    expect((await card("A", b.id)).steps?.[0]?.decided_as).toBe("member");
  }, 90_000);

  it("bước có hạn không đặt nhóm ⇒ quá hạn chuyển cấp về Toàn quyền (đồng hồ giả, không ngủ)", async () => {
    const owner = await groupId(c, "owner");
    const { id, run } = await openBy("B", 793, 10_000_000);
    const [snap] = await c.sql<Json[]>`select snapshot->'stages'->0->'after'->'escalate' as esc
      from hub.process_runs where id = ${run}`;
    const esc = typeof snap?.esc === "string" ? JSON.parse(snap.esc) : snap?.esc;
    expect(esc?.group_id).toBe(owner);
    await c.sql`update hub.review_tasks set escalate_at = now() - interval '1 minute'
      where process_run_id = ${run} and status = 'open'`;
    await remind(c);
    const [t] = await c.sql<
      Json[]
    >`select escalate_group_id::text as g, (escalated_at is not null) as done
      from hub.review_tasks where process_run_id = ${run} and status = 'open'`;
    expect({ g: t?.g, done: t?.done }).toEqual({ g: owner, done: true });
    const s0 = (await card("A", id)).steps?.[0];
    expect({ escalated: s0?.escalated, overdue: s0?.overdue, to: typeof s0?.escalated_to }).toEqual(
      {
        escalated: true,
        overdue: true,
        to: "string",
      },
    );
  }, 90_000);
});
