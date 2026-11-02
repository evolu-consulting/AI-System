// CR-109 · reviewer-visible (UAT 2026-11-02) · hub THẬT, cờ engine bật, chế độ thấy `org`: người duyệt của bước đang mở (thuộc
// Group của bước) nhưng NGOÀI cây quản lý của chủ HĐ vẫn mở được HĐ + thấy trong "Việc của tôi" + Đạt được; người ngoài (chỉ xem,
// không phải người duyệt) vẫn 404; user tenant khác không thấy gì; đã quyết ⇒ vẫn đọc được; người duyệt KHÔNG sửa được HĐ (RLS UPDATE).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  act,
  addRole,
  agentJson,
  approval,
  bump,
  CBASE,
  contractRow,
  errCode,
  groupId,
  seedContract,
  total,
  untilActions,
} from "../HD3/_hd3";
import { type Json, PA, type Role, T, waitStatus } from "../P-d/_support/pd";
import { type CtxCf, startCf } from "./_cf";

let c: CtxCf;
beforeAll(async () => {
  c = await startCf();
  // T (cuc) thuộc Group duyệt cấp 1 (Kế toán) + editor gói; X chỉ xem. Không ai trong hai người quản lý B.
  await addRole(c, "editor", [PA.T]);
  const viewer = await groupId(c, "viewer");
  await c.sql`insert into admin.group_members (tenant_id, group_id, user_id)
    values (${T.acme}, ${viewer}, ${PA.X.id}) on conflict do nothing`;
  await c.sql`insert into contracts.visibility_settings (tenant_id, mode) values (${T.acme}, 'org')
    on conflict (tenant_id) do update set mode = 'org'`;
  await bump(c);
  await untilActions(c, "T", ["read", "write"]);
  await untilActions(c, "X", ["read"]);
}, 180_000);
afterAll(async () => {
  await c?.stop();
});

/** B (chủ HĐ) bấm Đọc ⇒ lượt cấp 1 trên engine, run chờ duyệt. */
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

/** UPDATE trực tiếp dưới RLS thật (`contracts_rw`) như người `user` ⇒ số hàng sửa được + số hàng đọc được. */
async function asUser(user: string, id: string): Promise<{ read: number; updated: number }> {
  return c.sql.begin(async (tx) => {
    await tx`select set_config('app.tenant_id', ${T.acme}, true), set_config('app.user_id', ${user}, true)`;
    await tx`set local role contracts_rw`;
    const read = await tx`select id from contracts.contracts where id = ${id}`;
    const upd =
      await tx`update contracts.contracts set updated_at = now() where id = ${id} returning id`;
    return { read: read.length, updated: upd.length };
  });
}

describe("CR-109 · người duyệt của bước thấy HĐ cần duyệt (chế độ org)", () => {
  it("T (Group bước, ngoài cây của B) đọc HĐ + Việc của tôi + Đạt, X và tenant khác 404, đã quyết vẫn đọc, không sửa được", async () => {
    const { id, run } = await openBy("B", 791, 10_000_000);

    const asT = await c.call("T", "GET", `${CBASE}/${id}`);
    expect({ t: asT.status }).toEqual({ t: 200 });
    expect((await approval(c, "T", id)).json?.can_act).toBe(true);
    const w = (await c.call("T", "GET", "/pack/contracts/my-work")).json as Json;
    expect((w.approvals ?? []).some((x: Json) => x.contract_id === id)).toBe(true);

    expect({ x: (await c.call("X", "GET", `${CBASE}/${id}`)).status }).toEqual({ x: 404 });
    expect([403, 404]).toContain((await c.call("D", "GET", `${CBASE}/${id}`)).status);
    expect(await asUser(PA.X.id, id)).toEqual({ read: 0, updated: 0 });

    // RLS: người duyệt đọc được nhưng KHÔNG sửa được hàng HĐ
    expect(await asUser(PA.T.id, id)).toEqual({ read: 1, updated: 0 });

    expect((await act(c, "T", id, "approve")).status).toBe(200);
    await waitStatus(c.sql, run, "done");
    expect(await contractRow(c, id)).toMatchObject({ status: "active", confirmed_by: PA.T.id });

    // đã quyết ⇒ lịch sử vẫn xem được; X vẫn không
    expect({ after: (await c.call("T", "GET", `${CBASE}/${id}`)).status }).toEqual({ after: 200 });
    expect(await asUser(PA.T.id, id)).toEqual({ read: 1, updated: 0 });
    expect({ x: (await c.call("X", "GET", `${CBASE}/${id}`)).status }).toEqual({ x: 404 });
  }, 90_000);
});
