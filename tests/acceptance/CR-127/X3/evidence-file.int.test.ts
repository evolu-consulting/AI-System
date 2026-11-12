// FIX-EV · CR-127 X1/X3 · E1: ghi bằng chứng KÈM TỆP qua route thật (`/contracts/:id/hold`, `/obligations/:id/fulfill`). Trước đây mảng
// `attachment_ids` truyền thẳng vào `::uuid[]` ⇒ "malformed array literal" ⇒ 500. Tệp đúng tenant ⇒ 200 + bằng chứng giữ đúng id tệp;
// tệp của công ty khác ⇒ 4xx (không 500), không ghi gì.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { registerFlowEngine } from "../../../../apps/hub-api/src/modules/packs/kit/public";
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

/** HĐ DONE còn hiệu lực (owner = lan) + mốc thu 1.000 hạn +10 ngày. */
async function done(tenant: string = T.acme) {
  const k = await deal(c.sql, { sale: true, end: d(365), status: "done", tenant });
  await c.sql`update contracts.contracts set effect = 'active' where id = ${k}`;
  const [o] = await c.sql<{ id: string }[]>`insert into contracts.obligations
      (tenant_id, contract_id, party_key, direction, kind, seq, due_date, amount, source)
    select tenant_id, id, partner_key, 'receive', 'payment', 1, current_date + 10, 1000, 'manual'
    from contracts.contracts where id = ${k} returning id::text`;
  return { k, m: (o as { id: string }).id };
}
/** Tệp đã tải lên (hàng `hub.attachments`) của người phụ trách HĐ `k`, thuộc tenant của HĐ. */
async function file(k: string): Promise<string> {
  const id = crypto.randomUUID();
  await c.sql`insert into hub.attachments (id, tenant_id, user_id, origin, filename, safe_name, mime, size, sha256, storage_key)
    select ${id}::uuid, tenant_id, owner_user_id, 'upload', 'bien-ban.pdf', 'bien-ban.pdf', 'application/pdf', 17, ${"b".repeat(64)},
      tenant_id::text || '/' || ${id} from contracts.contracts where id = ${k}`;
  return id;
}
const evFiles = async (evId: string | null | undefined) =>
  (
    await c.sql<
      { a: string[] }[]
    >`select attachment_ids::text[] as a from hub.evidence where id = ${evId ?? null}::uuid`
  )[0]?.a;

describe("FIX-EV · bằng chứng kèm tệp", () => {
  it("tạm khoá kèm 1 tệp ⇒ 200, bằng chứng giữ tệp; tệp công ty khác ⇒ 4xx, không khoá", async () => {
    const { k } = await done();
    const f = await file(k);
    const h = await call(c, P.lan, "POST", `/contracts/${k}/hold`, {
      reason: "Tranh chấp",
      evidence: { note: "Có biên bản", attachment_ids: [f] },
    });
    expect([h.status, h.json?.state]).toEqual([200, "applied"]);
    const [x] = await c.sql<
      { ev: string }[]
    >`select evidence_id::text as ev from contracts.exec_requests
      where contract_id = ${k} order by requested_at desc limit 1`;
    expect(await evFiles(x?.ev)).toEqual([f]);

    const { k: k2 } = await done();
    const beta = await done(T.beta);
    const stray = await file(beta.k);
    const r = await call(c, P.lan, "POST", `/contracts/${k2}/hold`, {
      evidence: { note: "Tệp lạ", attachment_ids: [stray] },
    });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.status).toBeLessThan(500);
    const [held] = await c.sql<
      { h: string | null }[]
    >`select exec_hold_at::text as h from contracts.contracts where id = ${k2}`;
    expect(held?.h ?? null).toBeNull();
  });

  it("xác nhận mốc kèm 1 tệp ⇒ 200, mốc đóng, bằng chứng giữ tệp", async () => {
    const { k, m } = await done();
    const f = await file(k);
    const r = await call(c, P.lan, "POST", `/obligations/${m}/fulfill`, {
      evidence: { note: "Đã nhận chứng từ", attachment_ids: [f] },
    });
    expect(r.status).toBe(200);
    const [o] = await c.sql<
      { s: string; ev: string | null }[]
    >`select status as s, evidence_id::text as ev
      from contracts.obligations where id = ${m}`;
    expect(o?.s).toBe("done");
    expect(await evFiles(o?.ev)).toEqual([f]);
  });
});
