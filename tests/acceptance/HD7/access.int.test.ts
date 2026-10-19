// HD7-NFR-01 · HD7-AC06: quyền gói (viewer đọc, editor ghi, owner chỉnh tay điểm, không Group bị chặn) và cách ly tenant trên mọi
// route sổ thanh toán. Guard chạy TRƯỚC đọc thân ⇒ viewer gửi thân rác vẫn 403 và không ghi gì. Viết TRƯỚC code.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { arrangeHd7, type CtxN1, call, deal, events, P, schedule, startHd1 } from "./_support/hd7";

let c: CtxN1;
beforeAll(async () => {
  c = await startHd1();
}, 120_000);
afterAll(async () => {
  await c?.stop();
});

async function world() {
  await arrangeHd7(c);
  const id = await deal(c.sql, { sale: true, partner: "Quyền", tax: "0311110000", number: "Q-1" });
  const [ob] = await schedule(c, id, [{ due_date: "2026-10-13", amount: 1_000 }]);
  await call(c, P.hoa, "POST", `/obligations/${ob.id}/remind`, {});
  const [ev] = await events(c, ob.party);
  return { id, ob, ev };
}
const counts = async () =>
  (
    await c.sql<{ o: number; e: number; v: number; ce: number }[]>`select
      (select count(*)::int from contracts.obligations) as o, (select count(*)::int from contracts.partner_events) as e,
      (select count(*)::int from contracts.partner_event_voids) as v,
      (select count(*)::int from contracts.contract_events) as ce`
  )[0];

describe("HD7-AC06 · quyền gói", () => {
  it("viewer: mọi GET 200; mọi ghi 403 PACK_FORBIDDEN (kể cả thân rác), không ghi gì", async () => {
    const { id, ob, ev } = await world();
    const party = encodeURIComponent(ob.party);
    for (const path of [
      "/payments",
      `/obligations?contract_id=${id}`,
      `/partner-events?party=${party}`,
      `/contracts/${id}/partner`,
    ]) {
      const r = await call(c, P.tam, "GET", path);
      expect({ path, status: r.status }).toEqual({ path, status: 200 });
    }
    const before = await counts();
    const writes: [string, string, unknown][] = [
      ["PUT", `/contracts/${id}/schedule`, { garbage: true }],
      ["POST", `/obligations/${ob.id}/settle`, {}],
      ["POST", `/obligations/${ob.id}/postpone`, { to: "2027-01-01" }],
      ["POST", `/obligations/${ob.id}/remind`, {}],
      ["POST", `/partner-events/${ev.id}/void`, {}],
      ["POST", "/partner-events", { party: ob.party, role: "customer", type: "complaint" }],
    ];
    for (const [m, path, body] of writes) {
      const r = await call(c, P.tam, m, path, body);
      expect({ path, status: r.status, code: r.json?.error?.code }).toEqual({
        path,
        status: 403,
        code: "PACK_FORBIDDEN",
      });
    }
    expect(await counts()).toEqual(before);
  });
  it("không Group: GET và ghi đều 403; owner ghi được", async () => {
    const { id, ob } = await world();
    expect((await call(c, P.cuc, "GET", "/payments")).status).toBe(403);
    expect((await call(c, P.cuc, "POST", `/obligations/${ob.id}/remind`, {})).status).toBe(403);
    expect((await call(c, P.lan, "POST", `/obligations/${ob.id}/remind`, {})).status).toBe(200);
    expect((await call(c, P.lan, "PUT", `/contracts/${id}/schedule`, { rows: [] })).status).toBe(
      200,
    );
  });
  it("id sai dạng ⇒ 400; thân có tenant_id ⇒ 400 (tenant chỉ từ token)", async () => {
    const { ob } = await world();
    expect((await call(c, P.hoa, "POST", "/obligations/not-a-uuid/remind", {})).status).toBe(400);
    expect((await call(c, P.hoa, "POST", "/partner-events/abc/void", {})).status).toBe(400);
    const r = await call(c, P.hoa, "POST", `/obligations/${ob.id}/settle`, {
      tenant_id: crypto.randomUUID(),
    });
    expect(r.status).toBe(400);
  });
});

describe("HD7-AC06 · cách ly tenant", () => {
  it("beta không thấy và không chạm được dữ liệu acme: đọc rỗng, ghi ⇒ 404, không đổi gì", async () => {
    const { id, ob, ev } = await world();
    const b = await call(c, P.an, "GET", "/payments");
    expect([b.status, b.json?.rows, b.json?.total, b.json?.stats?.receive_open]).toEqual([
      200,
      [],
      0,
      "0",
    ]);
    expect((await call(c, P.an, "GET", `/obligations?contract_id=${id}`)).json).toEqual([]);
    expect(
      (await call(c, P.an, "GET", `/partner-events?party=${encodeURIComponent(ob.party)}`)).json,
    ).toEqual([]);
    const before = await counts();
    for (const [m, path, body] of [
      ["PUT", `/contracts/${id}/schedule`, { rows: [] }],
      ["POST", `/obligations/${ob.id}/settle`, {}],
      ["POST", `/obligations/${ob.id}/postpone`, { to: "2027-01-01" }],
      ["POST", `/obligations/${ob.id}/remind`, {}],
      ["POST", `/partner-events/${ev.id}/void`, {}],
      ["POST", "/partner-events", { party: ob.party, role: "customer", type: "complaint" }],
    ] as const) {
      const r = await call(c, P.an, m, path, body);
      expect({ path, status: r.status }).toEqual({ path, status: 404 });
    }
    expect(await counts()).toEqual(before);
  });
  it("sổ chỉ thêm: role gói không UPDATE/DELETE được sổ và bảng huỷ, không DELETE được đợt (42501)", async () => {
    await world();
    const { inPack, ROLE_RW, T } = await import("../HD1/_support/hd1");
    for (const q of [
      "update contracts.partner_events set note = 'x'",
      "delete from contracts.partner_events",
      "update contracts.partner_event_voids set by_user = null",
      "delete from contracts.partner_event_voids",
      "delete from contracts.obligations",
    ]) {
      // Lỗi trong tx làm hỏng cả tx: postgres.js ném ra ở `inPack` dù `fn` đã bắt ⇒ bắt quanh `inPack`.
      const code = await inPack(
        T.acme,
        async (tx) => {
          await tx.unsafe(q);
          return "ok";
        },
        ROLE_RW,
      ).catch((e: unknown) => (e as { code?: string }).code ?? "err");
      expect({ q, code }).toEqual({ q, code: "42501" });
    }
  });
});
