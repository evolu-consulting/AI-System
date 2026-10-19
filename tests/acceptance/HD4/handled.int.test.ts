// HD4-FR-06 · HD4-AC06: `POST /pack/contracts/contracts/:id/handled` qua hub-api thật (JWT, guard gói, RLS) — quyền, kiểm thân,
// HĐ chưa duyệt/phụ lục, tenant khác, trạng thái theo kết quả, event + outbox, lịch nhắc dừng.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { arrange, CBASE, type CtxN1, P, startHd1, T } from "../HD1/_support/hd1";
import { addContract, needHd4, rowOf } from "./_support/hd4";

let c: CtxN1;
beforeAll(async () => {
  c = await startHd1();
}, 120_000);
afterAll(async () => {
  await c?.stop();
});
const post = (who: (typeof P)[keyof typeof P], id: string, body: unknown) =>
  c.hubCall(who, "POST", `${CBASE}/${id}/handled`, body);

describe("HD4-FR-06 · ghi kết quả xử lý", () => {
  it("HD4-AC06 · editor ghi not_renewed ⇒ 200 terminated, handled {outcome, by, at}, version+1, event + outbox", async () => {
    await arrange(c);
    await needHd4(c.sql);
    const id = await addContract(c.sql, { end: "2027-12-31" });
    const r = await post(P.hoa, id, { outcome: "not_renewed" });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({
      id,
      status: "terminated",
      handled: { outcome: "not_renewed", by: P.hoa.id },
      action_deadline: "2027-12-01",
      version: 2,
    });
    expect(await rowOf(c.sql, id)).toMatchObject({
      status: "terminated",
      due: "-infinity",
      version: 2,
    });
    const [n] = await c.sql`select
      (select count(*)::int from contracts.contract_events where contract_id = ${id} and type = 'handled') as ev,
      (select count(*)::int from contracts.index_outbox where entity_id = ${id}) as ob`;
    expect(n).toEqual({ ev: 1, ob: 1 });
  });
  it("HD4-FR-06 · negotiating ⇒ trạng thái theo ngày giữ nguyên (active còn xa hạn)", async () => {
    await arrange(c);
    const id = await addContract(c.sql, { end: "2030-12-31" });
    const r = await post(P.hoa, id, { outcome: "negotiating" });
    expect([r.status, r.json?.status, r.json?.handled?.outcome]).toEqual([
      200,
      "active",
      "negotiating",
    ]);
  });
  it("HD4-AC06 · viewer 403; outcome lạ / khoá lạ 400; id sai dạng 400", async () => {
    await arrange(c);
    const id = await addContract(c.sql);
    expect((await post(P.tam, id, { outcome: "renewed" })).status).toBe(403);
    expect((await post(P.hoa, id, { outcome: "bogus" })).status).toBe(400);
    expect((await post(P.hoa, id, { outcome: "renewed", tenant_id: T.beta })).status).toBe(400);
    expect((await post(P.hoa, "not-a-uuid", { outcome: "renewed" })).status).toBe(400);
    expect((await rowOf(c.sql, id)).handled).toBeNull();
  });
  it("HD4-AC06 · HĐ needs_review hoặc phụ lục ⇒ 409 CONTRACT_NOT_CONFIRMED; HĐ tenant khác / id lạ ⇒ 404", async () => {
    await arrange(c);
    const nr = await addContract(c.sql, { status: "needs_review" });
    const parent = await addContract(c.sql);
    const ap = await addContract(c.sql, { kind: "appendix", parent });
    const other = await addContract(c.sql, { tenant: T.beta, owner: P.an.id });
    for (const id of [nr, ap]) {
      const r = await post(P.hoa, id, { outcome: "renewed" });
      expect([r.status, r.json?.error?.code ?? r.json?.code]).toEqual([
        409,
        "CONTRACT_NOT_CONFIRMED",
      ]);
    }
    expect((await post(P.hoa, other, { outcome: "renewed" })).status).toBe(404);
    expect(
      (await post(P.hoa, "4d4fffff-0000-4000-8000-000000000000", { outcome: "renewed" })).status,
    ).toBe(404);
    expect((await rowOf(c.sql, other)).handled).toBeNull();
  });
});
