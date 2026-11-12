// CR-127 · X4 · BR-56 · spec §4.1 `POST /obligations/:id/penalty`, `GET /contracts/:id/penalties`: phạt ước tính theo điều khoản; Ghi vào công nợ (đúng
// chiều: đối tác trễ ⇒ `receive`, mình trễ ⇒ `pay`) / Miễn phạt (bằng chứng); quyết hai lần ⇒ 409; mốc chưa trễ ⇒ 422; vai; chéo tenant ⇒ 404.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { arrangeV2d, type CtxN1, call, d, deal, P, startHd1, T } from "../../V2-D/_support/v2d";

let c: CtxN1;
beforeAll(async () => {
  c = await startHd1();
  await arrangeV2d(c);
}, 120_000);
afterAll(async () => {
  await c?.stop();
});

const ev = { note: "Đối tác xin giảm, đã trao đổi" };
const codeOf = (r: { json?: { error?: { code?: string }; code?: string } }) =>
  r.json?.error?.code ?? r.json?.code;

/** HĐ bán DONE (owner = lan) + điều khoản phạt (đối tác trễ thanh toán 0,1%/ngày của mốc; mình trễ giao 1% giá trị/ngày, trần 5.000) + mốc thu tiền trễ `days` ngày. */
async function late(days: number, tenant: string = T.acme) {
  const k = await deal(c.sql, { sale: true, end: d(365), status: "done", tenant });
  await c.sql`update contracts.contracts set effect = 'active' where id = ${k}`;
  await c.sql`insert into contracts.penalty_terms (tenant_id, contract_id, party, trigger, rate_pct, basis, cap_amount, source)
    values (${tenant}, ${k}, 'partner', 'late_payment', 0.1, 'per_day_of_milestone', null, 'manual'),
           (${tenant}, ${k}, 'ours', 'late_delivery', 1, 'per_day_of_value', 5000, 'manual')`;
  const [o] = await c.sql<{ id: string }[]>`insert into contracts.obligations
      (tenant_id, contract_id, party_key, direction, kind, seq, due_date, amount, source)
    select tenant_id, id, partner_key, 'receive', 'payment', 1, (now() at time zone 'Asia/Ho_Chi_Minh')::date - ${days}::int, 2000000, 'manual'
    from contracts.contracts where id = ${k} returning id::text`;
  return { k, m: (o as { id: string }).id };
}
const row = async (id: string) =>
  (
    await c.sql<
      Record<string, string | number | null>[]
    >`select direction, kind, owner, status, amount::float8 as amount, penalty_decision, penalty_obligation_id::text as pid,
        parent_obligation_id::text as parent from contracts.obligations where id = ${id}`
  )[0];
const penalties = async (k: string) =>
  (
    await c.sql<
      { id: string }[]
    >`select id::text from contracts.obligations where contract_id = ${k} and kind = 'penalty'`
  ).length;

describe("CR-127 X4 · phạt chậm", () => {
  it("GET penalties: phạt ước tính (đối tác trễ 10 ngày ⇒ 2.000.000 × 0,1% × 10 = 20.000), chiều receive", async () => {
    const { k, m } = await late(10);
    const r = await call(c, P.lan, "GET", `/contracts/${k}/penalties`);
    expect(r.status).toBe(200);
    expect(r.json?.items).toHaveLength(1);
    expect(r.json?.items[0]).toMatchObject({
      obligation_id: m,
      days_late: 10,
      direction: "receive",
      decision: null,
      estimate: { amount: 20_000, capped: false, basis: "per_day_of_milestone" },
    });
  });

  it("book ⇒ mốc phạt đúng chiều (receive, owner partner, con của mốc trễ); không tự trừ tiền mốc gốc; quyết lần hai (book/waive) ⇒ 409, không sinh thêm", async () => {
    const { k, m } = await late(10);
    const b = await call(c, P.lan, "POST", `/obligations/${m}/penalty`, {
      decision: "book",
      amount: 20_000,
    });
    expect([b.status, b.json?.state]).toEqual([200, "booked"]);
    expect(await row(b.json?.penalty_obligation_id)).toMatchObject({
      direction: "receive",
      kind: "penalty",
      owner: "partner",
      status: "open",
      amount: 20_000,
      parent: m,
    });
    expect(await row(m)).toMatchObject({
      status: "open",
      amount: 2_000_000,
      penalty_decision: "booked",
      pid: b.json?.penalty_obligation_id,
    });
    const again = await call(c, P.lan, "POST", `/obligations/${m}/penalty`, {
      decision: "book",
      amount: 20_000,
    });
    expect([again.status, codeOf(again)]).toEqual([409, "PENALTY_DECIDED"]);
    const w = await call(c, P.lan, "POST", `/obligations/${m}/penalty`, {
      decision: "waive",
      evidence: ev,
    });
    expect([w.status, codeOf(w)]).toEqual([409, "PENALTY_DECIDED"]);
    expect(await penalties(k)).toBe(1);
    const list = await call(c, P.lan, "GET", `/contracts/${k}/penalties`);
    expect(list.json?.items[0]).toMatchObject({ decision: "booked" });
  });

  it("mình trễ (mốc giao, owner ours) ⇒ book chiều pay; waive cần bằng chứng (422) rồi `waived`, không sinh công nợ, quyết lại ⇒ 409", async () => {
    const { k } = await late(3);
    const [o] = await c.sql<{ id: string }[]>`insert into contracts.obligations
        (tenant_id, contract_id, party_key, direction, kind, seq, due_date, amount, source)
      select tenant_id, id, partner_key, 'receive', 'delivery', 2, (now() at time zone 'Asia/Ho_Chi_Minh')::date - 4, 1000000, 'manual'
      from contracts.contracts where id = ${k} returning id::text`;
    const m = (o as { id: string }).id;
    expect((await row(m))?.owner).toBe("ours");
    const bk = await call(c, P.lan, "POST", `/obligations/${m}/penalty`, {
      decision: "book",
      amount: 5_000,
    });
    expect([bk.status, bk.json?.state]).toEqual([200, "booked"]);
    expect(await row(bk.json?.penalty_obligation_id)).toMatchObject({
      direction: "pay",
      owner: "ours",
      kind: "penalty",
    });
    const { k: k2, m: m2 } = await late(5);
    const none = await call(c, P.lan, "POST", `/obligations/${m2}/penalty`, { decision: "waive" });
    expect([none.status, codeOf(none)]).toEqual([422, "EVIDENCE_REQUIRED"]);
    expect((await row(m2))?.penalty_decision).toBeNull();
    const ok = await call(c, P.lan, "POST", `/obligations/${m2}/penalty`, {
      decision: "waive",
      evidence: ev,
    });
    expect([ok.status, ok.json?.state]).toEqual([200, "waived"]);
    expect((await row(m2))?.penalty_decision).toBe("waived");
    expect(await penalties(k2)).toBe(0);
    const again = await call(c, P.lan, "POST", `/obligations/${m2}/penalty`, {
      decision: "book",
      amount: 100,
    });
    expect([again.status, codeOf(again)]).toEqual([409, "PENALTY_DECIDED"]);
  });

  it("mốc chưa trễ ⇒ 422; thiếu amount khi book ⇒ 400; người không phụ trách ⇒ 403; HĐ tenant khác ⇒ 404 (không ghi)", async () => {
    const { m } = await late(-5); // hạn +5 ngày
    const n = await call(c, P.lan, "POST", `/obligations/${m}/penalty`, {
      decision: "book",
      amount: 10,
    });
    expect([n.status, codeOf(n)]).toEqual([422, "PENALTY_NOT_APPLICABLE"]);
    const { m: m2 } = await late(10);
    const bad = await call(c, P.lan, "POST", `/obligations/${m2}/penalty`, { decision: "book" });
    expect(bad.status).toBe(400);
    const other = await call(c, P.hoa, "POST", `/obligations/${m2}/penalty`, {
      decision: "waive",
      evidence: ev,
    });
    expect([other.status, codeOf(other)]).toEqual([403, "PENALTY_FORBIDDEN"]);
    const beta = await late(10, T.beta);
    const cross = await call(c, P.lan, "POST", `/obligations/${beta.m}/penalty`, {
      decision: "waive",
      evidence: ev,
    });
    expect(cross.status).toBe(404);
    expect((await row(beta.m))?.penalty_decision).toBeNull();
    const crossGet = await call(c, P.lan, "GET", `/contracts/${beta.k}/penalties`);
    expect(crossGet.status).toBe(404);
  });

  it("book số khác ước tính hoặc không có ước tính ⇒ cần ý kiến (422); vượt trần ⇒ 422 PENALTY_OVER_CAP; có ý kiến ⇒ ghi, nhật ký giữ ước tính", async () => {
    const { m } = await late(10); // ước tính 20.000, không trần
    const no = await call(c, P.lan, "POST", `/obligations/${m}/penalty`, {
      decision: "book",
      amount: 30_000,
    });
    expect([no.status, codeOf(no)]).toEqual([422, "EVIDENCE_REQUIRED"]);
    const yes = await call(c, P.lan, "POST", `/obligations/${m}/penalty`, {
      decision: "book",
      amount: 30_000,
      evidence: ev,
    });
    expect([yes.status, yes.json?.state]).toEqual([200, "booked"]);
    const [a] = await c.sql<
      { e: { amount: number } | null }[]
    >`select data -> 'estimate' as e from contracts.contract_events
      where type = 'obligation_penalty_booked' and data ->> 'obligation_id' = ${m}`;
    expect(a?.e?.amount).toBe(20_000);
    // mốc giao trễ (mình trễ): trần 5.000
    const { k } = await late(3);
    const [o] = await c.sql<{ id: string }[]>`insert into contracts.obligations
        (tenant_id, contract_id, party_key, direction, kind, seq, due_date, amount, source)
      select tenant_id, id, partner_key, 'receive', 'delivery', 2, (now() at time zone 'Asia/Ho_Chi_Minh')::date - 4, 1000000, 'manual'
      from contracts.contracts where id = ${k} returning id::text`;
    const dm = (o as { id: string }).id;
    const over = await call(c, P.lan, "POST", `/obligations/${dm}/penalty`, {
      decision: "book",
      amount: 6_000,
      evidence: ev,
    });
    expect([over.status, codeOf(over)]).toEqual([422, "PENALTY_OVER_CAP"]);
    // mốc loại khác không có điều khoản khớp ⇒ reason no_term, book không ý kiến ⇒ 422
    const [x] = await c.sql<{ id: string }[]>`insert into contracts.obligations
        (tenant_id, contract_id, party_key, direction, kind, seq, due_date, amount, source)
      select tenant_id, id, partner_key, 'pay', 'other', 3, (now() at time zone 'Asia/Ho_Chi_Minh')::date - 2, 1000, 'manual'
      from contracts.contracts where id = ${k} returning id::text`;
    const xm = (x as { id: string }).id;
    const list = await call(c, P.lan, "GET", `/contracts/${k}/penalties`);
    const view = (
      (list.json?.items ?? []) as {
        obligation_id: string;
        estimate: unknown;
        reason: string | null;
      }[]
    ).find((i) => i.obligation_id === xm);
    expect([view?.estimate, view?.reason]).toEqual([null, "no_term"]);
    const nb = await call(c, P.lan, "POST", `/obligations/${xm}/penalty`, {
      decision: "book",
      amount: 500,
    });
    expect([nb.status, codeOf(nb)]).toEqual([422, "EVIDENCE_REQUIRED"]);
  });

  it("mốc có yêu cầu thay đổi chờ duyệt ⇒ 409 CHANGE_PENDING; HĐ đang tạm khoá vẫn quyết được; trưởng phòng của người phụ trách được phép", async () => {
    const { k, m } = await late(10);
    await c.sql`insert into contracts.exec_requests (tenant_id, contract_id, obligation_id, kind, requested_by)
      values (${T.acme}, ${k}, ${m}, 'postpone', ${P.lan.id})`;
    const pend = await call(c, P.lan, "POST", `/obligations/${m}/penalty`, {
      decision: "waive",
      evidence: ev,
    });
    expect([pend.status, codeOf(pend)]).toEqual([409, "CHANGE_PENDING"]);
    await c.sql`delete from contracts.exec_requests where obligation_id = ${m}`;
    await c.sql`update contracts.contracts set exec_hold_at = now(), exec_hold_by = ${P.lan.id} where id = ${k}`;
    const held = await call(c, P.lan, "POST", `/obligations/${m}/penalty`, {
      decision: "waive",
      evidence: ev,
    });
    expect([held.status, held.json?.state]).toEqual([200, "waived"]);
    const { m: m2 } = await late(10);
    const [g] = await c.sql<{ group_id: string }[]>`select group_id::text from admin.group_members
      where tenant_id = ${T.acme} and user_id = ${P.lan.id} limit 1`;
    await c.sql`insert into admin.departments (tenant_id, group_id, head_user_id) values (${T.acme}, ${g?.group_id ?? null}, ${P.hoa.id})
      on conflict (group_id) do update set head_user_id = excluded.head_user_id`;
    try {
      const head = await call(c, P.hoa, "POST", `/obligations/${m2}/penalty`, {
        decision: "waive",
        evidence: ev,
      });
      expect([head.status, head.json?.state]).toEqual([200, "waived"]);
    } finally {
      await c.sql`delete from admin.departments where group_id = ${g?.group_id ?? null}`;
    }
  });
});
