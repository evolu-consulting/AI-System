// CR-127 · X3 · spec §4 (hold/release, yêu cầu thay đổi), R#18, BR-41/52/53/75/76: tạm khoá/mở khoá và dời hạn/tách/miễn phạt qua `exec_requests`;
// không có quy trình ⇒ áp ngay; có quy trình ⇒ pending rồi duyệt ⇒ áp / từ chối ⇒ giữ nguyên; một yêu cầu mở mỗi mốc/HĐ; thiếu bằng chứng 422; vai; chéo tenant.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Tx } from "@ai/db";
import {
  flowPortRegistry,
  registerFlowEngine,
} from "../../../../apps/hub-api/src/modules/packs/kit/public";
import { arrangeV2d, type CtxN1, call, d, deal, P, startHd1, T } from "../../V2-D/_support/v2d";

let c: CtxN1;
beforeAll(async () => {
  c = await startHd1();
  await arrangeV2d(c);
}, 120_000);
afterAll(async () => {
  registerFlowEngine(null);
  await c?.stop();
});

const ev = { note: "Đã trao đổi với đối tác, có biên bản" };
const EVENT = "fulfilment.change_requested";
const codeOf = (r: { json?: { error?: { code?: string }; code?: string } }) =>
  r.json?.error?.code ?? r.json?.code;
const withFlow = (on: boolean) =>
  registerFlowEngine(
    on ? ({ runControl: {}, availability: { hasFlowFor: async () => true } } as never) : null,
  );
const handler = () => {
  const h = flowPortRegistry.outcomeHandlerFor("contracts", EVENT);
  if (!h) throw new Error("chưa có OutcomeHandler fulfilment.change_requested");
  return h;
};
const apply = (ref: string, outcome: string) =>
  c.hub.db.db.transaction((tx) =>
    handler().apply(tx as unknown as Tx, {
      tenantId: T.acme,
      runId: crypto.randomUUID(),
      event: EVENT,
      ref,
      outcome,
      actorId: null,
    }),
  );

/** HĐ DONE còn hiệu lực (owner = lan) + một mốc thu tiền 1.000 hạn +10 ngày (SQL trực tiếp: HĐ DONE khoá nội dung — K4). */
async function done(tenant: string = T.acme) {
  const k = await deal(c.sql, { sale: true, end: d(365), status: "done", tenant });
  await c.sql`update contracts.contracts set effect = 'active' where id = ${k}`;
  const [o] = await c.sql<{ id: string }[]>`insert into contracts.obligations
      (tenant_id, contract_id, party_key, direction, kind, seq, due_date, amount, source)
    select tenant_id, id, partner_key, 'receive', 'payment', 1, current_date + 10, 1000, 'manual'
    from contracts.contracts where id = ${k} returning id::text`;
  return { k, m: (o as { id: string }).id };
}
const holdAt = async (k: string) =>
  (
    await c.sql<
      { h: string | null }[]
    >`select exec_hold_at::text as h from contracts.contracts where id = ${k}`
  )[0]?.h;
const due = async (m: string) =>
  (
    await c.sql<
      { d: string }[]
    >`select due_date::text as d from contracts.obligations where id = ${m}`
  )[0]?.d;
const reqStatus = async (id: string) =>
  (
    await c.sql<{ status: string }[]>`select status from contracts.exec_requests where id = ${id}`
  )[0]?.status;

describe("CR-127 X3 · tạm khoá / mở khoá", () => {
  it("không có quy trình ⇒ áp ngay (có bằng chứng); mở khoá ⇒ gỡ; khoá lần hai / mở khi không khoá ⇒ 409", async () => {
    const { k } = await done();
    const h = await call(c, P.lan, "POST", `/contracts/${k}/hold`, {
      reason: "Tranh chấp",
      evidence: ev,
    });
    expect([h.status, h.json?.state]).toEqual([200, "applied"]);
    expect(await holdAt(k)).toBeTruthy();
    const again = await call(c, P.lan, "POST", `/contracts/${k}/hold`, { evidence: ev });
    expect([again.status, codeOf(again)]).toEqual([409, "HOLD_EXISTS"]);
    const r = await call(c, P.lan, "POST", `/contracts/${k}/release`, { evidence: ev });
    expect([r.status, r.json?.state]).toEqual([200, "applied"]);
    expect(await holdAt(k)).toBeNull();
    const r2 = await call(c, P.lan, "POST", `/contracts/${k}/release`, { evidence: ev });
    expect([r2.status, codeOf(r2)]).toEqual([409, "NOT_HELD"]);
  });

  it("thiếu bằng chứng ⇒ 422 EVIDENCE_REQUIRED (không khoá); vai không đủ ⇒ 403 HOLD_FORBIDDEN; HĐ tenant khác ⇒ 404", async () => {
    const { k } = await done();
    const none = await call(c, P.lan, "POST", `/contracts/${k}/hold`, { reason: "x" });
    expect([none.status, codeOf(none)]).toEqual([422, "EVIDENCE_REQUIRED"]);
    expect(await holdAt(k)).toBeNull();
    const other = await call(c, P.hoa, "POST", `/contracts/${k}/hold`, { evidence: ev });
    expect([other.status, codeOf(other)]).toEqual([403, "HOLD_FORBIDDEN"]);
    const beta = await done(T.beta);
    const cross = await call(c, P.lan, "POST", `/contracts/${beta.k}/hold`, { evidence: ev });
    expect(cross.status).toBe(404);
    expect(await holdAt(beta.k)).toBeNull();
  });

  it("trưởng phòng của người phụ trách khoá được; `can.hold` của chi tiết theo vai", async () => {
    const { k } = await done();
    const before = await call(c, P.hoa, "GET", `/contracts/${k}`);
    expect(before.json?.can?.hold).toBe(false);
    const [g] = await c.sql<{ group_id: string }[]>`select group_id::text from admin.group_members
      where tenant_id = ${T.acme} and user_id = ${P.lan.id} limit 1`;
    await c.sql`insert into admin.departments (tenant_id, group_id, head_user_id) values (${T.acme}, ${g?.group_id ?? null}, ${P.hoa.id})
      on conflict (group_id) do update set head_user_id = excluded.head_user_id`;
    try {
      const after = await call(c, P.hoa, "GET", `/contracts/${k}`);
      expect(after.json?.can?.hold).toBe(true);
      const h = await call(c, P.hoa, "POST", `/contracts/${k}/hold`, { evidence: ev });
      expect([h.status, h.json?.state]).toEqual([200, "applied"]);
    } finally {
      await c.sql`delete from admin.departments where group_id = ${g?.group_id ?? null}`;
    }
  });

  it("có quy trình ⇒ pending (chưa khoá), yêu cầu thứ hai 409; duyệt ⇒ khoá (một lần); từ chối ⇒ không khoá + báo", async () => {
    const a = await done();
    withFlow(true);
    try {
      const h = await call(c, P.lan, "POST", `/contracts/${a.k}/hold`, {
        reason: "Chờ pháp lý",
        evidence: ev,
      });
      expect([h.status, h.json?.state]).toEqual([202, "pending"]);
      const id = h.json.request_id as string;
      expect([await reqStatus(id), await holdAt(a.k)]).toEqual(["pending", null]);
      const again = await call(c, P.lan, "POST", `/contracts/${a.k}/hold`, { evidence: ev });
      expect([again.status, codeOf(again)]).toEqual([409, "CHANGE_PENDING_EXISTS"]);
      expect(await apply(id, "approved")).toBe("applied");
      expect([await reqStatus(id), !!(await holdAt(a.k))]).toEqual(["applied", true]);
      expect(await apply(id, "approved")).toBe("already_applied");

      const b = await done();
      const h2 = await call(c, P.lan, "POST", `/contracts/${b.k}/hold`, { evidence: ev });
      const id2 = h2.json.request_id as string;
      expect(await apply(id2, "rejected")).toBe("applied");
      expect([await reqStatus(id2), await holdAt(b.k)]).toEqual(["rejected", null]);
      const [n] = await c.sql<
        { n: string }[]
      >`select count(*)::text as n from hub.notifications where dedup_key = ${`exec-request:${id2}`}`;
      expect(Number(n?.n)).toBe(1);
    } finally {
      withFlow(false);
    }
  });
});

describe("CR-127 X3 · áp muộn", () => {
  it("duyệt tạm khoá khi HĐ đã hết hiệu lực từ lúc lập yêu cầu ⇒ yêu cầu bị từ chối, không khoá", async () => {
    const a = await done();
    withFlow(true);
    try {
      const h = await call(c, P.lan, "POST", `/contracts/${a.k}/hold`, { evidence: ev });
      const id = h.json.request_id as string;
      await c.sql`update contracts.contracts set effect = 'expired' where id = ${a.k}`;
      expect(await apply(id, "approved")).toBe("applied");
      expect([await reqStatus(id), await holdAt(a.k)]).toEqual(["rejected", null]);
    } finally {
      withFlow(false);
    }
  });
});

describe("CR-127 X3 · yêu cầu thay đổi thực hiện", () => {
  const post = (m: string, b: object, who = P.lan) =>
    call(c, who, "POST", `/obligations/${m}/change-requests`, b);

  it("không có quy trình ⇒ dời hạn áp ngay; thiếu bằng chứng 422; vai không đủ 403", async () => {
    const { m } = await done();
    const to = d(30);
    const none = await post(m, { kind: "postpone", payload: { to } });
    expect([none.status, codeOf(none)]).toEqual([422, "EVIDENCE_REQUIRED"]);
    const other = await post(m, { kind: "postpone", payload: { to }, evidence: ev }, P.hoa);
    expect([other.status, codeOf(other)]).toEqual([403, "CHANGE_FORBIDDEN"]);
    const r = await post(m, { kind: "postpone", payload: { to }, evidence: ev });
    expect([r.status, r.json?.state]).toEqual([200, "applied"]);
    expect(await due(m)).toBe(to);
  });

  it("có quy trình ⇒ pending (mốc giữ nguyên), yêu cầu thứ hai cùng mốc 409; duyệt ⇒ áp một lần; từ chối ⇒ giữ nguyên", async () => {
    const { m } = await done();
    const was = await due(m);
    withFlow(true);
    try {
      const r = await post(m, { kind: "postpone", payload: { to: d(40) }, evidence: ev });
      expect([r.status, r.json?.state]).toEqual([202, "pending"]);
      const id = r.json.request_id as string;
      expect(await due(m)).toBe(was);
      const second = await post(m, {
        kind: "split",
        payload: { due_date: d(50), amount: 100 },
        evidence: ev,
      });
      expect([second.status, codeOf(second)]).toEqual([409, "CHANGE_PENDING_EXISTS"]);
      expect(await apply(id, "approved")).toBe("applied");
      expect([await reqStatus(id), await due(m)]).toEqual(["applied", d(40)]);
      expect(await apply(id, "approved")).toBe("already_applied");
      const r2 = await post(m, { kind: "postpone", payload: { to: d(60) }, evidence: ev });
      const id2 = r2.json.request_id as string;
      expect(await apply(id2, "rejected")).toBe("applied");
      expect([await reqStatus(id2), await due(m)]).toEqual(["rejected", d(40)]);
    } finally {
      withFlow(false);
    }
  });

  it("tách mốc tiền: gốc còn phần dư, hàng con mang phần tách; tách ≥ số tiền ⇒ 422; miễn phạt mốc không phải phạt ⇒ 422", async () => {
    const { m } = await done();
    const bad = await post(m, {
      kind: "split",
      payload: { due_date: d(50), amount: 1000 },
      evidence: ev,
    });
    expect([bad.status, codeOf(bad)]).toEqual([422, "CHANGE_INVALID"]);
    const r = await post(m, {
      kind: "split",
      payload: { due_date: d(50), amount: 400 },
      evidence: ev,
    });
    expect([r.status, r.json?.state]).toEqual([200, "applied"]);
    const [o] = await c.sql<
      { amount: string }[]
    >`select amount::text from contracts.obligations where id = ${m}`;
    expect(Number(o?.amount)).toBe(600);
    const w = await post(m, { kind: "waive_penalty", payload: {}, evidence: ev });
    expect([w.status, codeOf(w)]).toEqual([422, "CHANGE_INVALID"]);
  });

  it("PATCH mốc HĐ DONE: đổi số tiền ⇒ 409 USE_NEW_VERSION; chỉ due_date + bằng chứng ⇒ yêu cầu dời hạn", async () => {
    const { m } = await done();
    const v = await call(c, P.lan, "PATCH", `/milestones/${m}`, { amount: 5 });
    expect([v.status, codeOf(v)]).toEqual([409, "USE_NEW_VERSION"]);
    const to = d(25);
    const r = await call(c, P.lan, "PATCH", `/milestones/${m}`, { due_date: to, evidence: ev });
    expect([r.status, r.json?.state]).toEqual([200, "applied"]);
    expect(await due(m)).toBe(to);
  });
});
