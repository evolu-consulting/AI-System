// CR-127 · Q1c · spec §3 (#3, #4, #8), §4.1 · viết lại AC mất phủ khi gỡ máy duyệt cũ: "Xác nhận & lưu" = Gửi trên luồng mới (quy trình engine,
// không còn cờ duyệt/`needs_review`). (a) Gắn sản phẩm cùng MỘT tx với việc chuyển trạng thái (không quy trình ⇒ done; có quy trình ⇒ processing);
// (b) mapping sai ⇒ 422 PRODUCT_INVALID, ROLLBACK cả lệnh (HĐ giữ Nháp, không lượt duyệt); (c) tách quyền: viewer 403, tenant khác 404,
// chỉ người gửi được Rút về; (d) cách ly tenant của lượt duyệt. Engine giả qua sổ kit (`registerFlowEngine`), DB + HTTP thật.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { registerFlowEngine } from "../../../../apps/hub-api/src/modules/packs/kit/public";
import {
  arrangeV2a,
  type CtxN1,
  call,
  itemRows,
  type Json,
  makeProduct,
  P,
  reviewOf,
  seedReview,
  snapshot,
  startHd1,
  T,
} from "../../V2-G/_support/v2g";

let c: CtxN1;
let hasFlow = false;
beforeAll(async () => {
  c = await startHd1();
  registerFlowEngine({
    availability: { hasFlowFor: async () => hasFlow },
    runControl: { inspect: async () => null, cancel: async () => true },
  } as never);
}, 120_000);
afterAll(async () => {
  registerFlowEngine(null);
  await c?.stop();
});

async function fresh(n = 1) {
  await arrangeV2a(c);
  await c.sql`truncate contracts.products cascade`;
  await c.sql`delete from contracts.approvals where tenant_id = ${T.acme}`; // không có FK tới contracts ⇒ dọn riêng
  const s = await seedReview(c, n, { deal: "sell", items: [{ name: "Thùng carton", qty: 2 }] });
  const sp = await makeProduct(c, P.hoa, { name: "Thùng carton 5 lớp", group: "goods" });
  return { s, sp, item: s.items[0] as string };
}
const runsOf = async (id: string) =>
  (
    await c.sql<
      { n: number }[]
    >`select count(*)::int as n from contracts.approvals where contract_id = ${id}`
  )[0]?.n;

describe("CR-127 Q1 · Xác nhận & lưu gắn sản phẩm trong MỘT tx", () => {
  it("Q1-AC3a · NF1 · không có quy trình khớp ⇒ 409 NO_APPROVAL_FLOW, HĐ giữ Nháp, không ghi gì, không lượt duyệt, không sự kiện", async () => {
    hasFlow = false;
    const { s, sp, item } = await fresh();
    const before = await snapshot(c.sql, s.id);
    const r = await reviewOf(c, s.id, {
      version: 1,
      products: [{ item_id: item, product_id: sp.id }],
    });
    expect([r.status, r.json?.error?.code]).toEqual([409, "NO_APPROVAL_FLOW"]);
    expect(await snapshot(c.sql, s.id)).toEqual(before);
    expect(await runsOf(s.id)).toBe(0);
    const [ev] = await c.sql<{ n: number }[]>`select count(*)::int as n from hub.flow_events
      where ref = ${s.id} and event = 'contract.submitted'`;
    expect(ev?.n).toBe(0);
  });

  it("Q1-AC3b · có quy trình khớp ⇒ processing + sản phẩm gắn ngay ở bản nháp + một lượt duyệt engine + một sự kiện contract.submitted", async () => {
    hasFlow = true;
    const { s, sp, item } = await fresh();
    const r = await reviewOf(c, s.id, {
      version: 1,
      products: [{ item_id: item, product_id: sp.id }],
    });
    expect([r.status, r.json?.status]).toEqual([200, "processing"]);
    expect((await itemRows(c.sql, s.id))[0]?.product_id).toBe(sp.id);
    const [a] = await c.sql<{ mode: string; n: number }[]>`select mode, count(*) over ()::int as n
      from contracts.approvals where contract_id = ${s.id}`;
    expect(a).toEqual({ mode: "engine", n: 1 });
    const [ev] = await c.sql<{ n: number }[]>`select count(*)::int as n from hub.flow_events
      where ref = ${s.id} and event = 'contract.submitted'`;
    expect(ev?.n).toBe(1);
    hasFlow = false;
  });

  it("Q1-AC3c · mapping sai (dòng lạ / sản phẩm không có / sản phẩm tenant khác) ⇒ 422, không ghi gì, HĐ giữ Nháp", async () => {
    for (const flow of [false, true]) {
      hasFlow = flow;
      const { s, sp, item } = await fresh();
      const theirs = await makeProduct(c, P.an, { name: "SP beta", group: "goods" });
      const bad: Json[][] = [
        [{ item_id: crypto.randomUUID(), product_id: sp.id }],
        [{ item_id: item, product_id: "e1000000-0000-4000-8000-0000000000ff" }],
        [{ item_id: item, product_id: theirs.id }],
      ];
      for (const products of bad) {
        const before = await snapshot(c.sql, s.id);
        const r = await reviewOf(c, s.id, { version: 1, fields: { title: "Đổi tên" }, products });
        expect([flow, r.status]).toEqual([flow, 422]);
        // dòng lạ có thể bị chặn ở lớp kiểm đầu vào (VALIDATION_ERROR); SP không có / của tenant khác ⇒ PRODUCT_INVALID
        expect(["PRODUCT_INVALID", "VALIDATION_ERROR"]).toContain(r.json?.error?.code);
        expect(await snapshot(c.sql, s.id)).toEqual(before);
        expect(await runsOf(s.id)).toBe(0);
        const [k] = await c.sql<
          { status: string }[]
        >`select status from contracts.contracts where id = ${s.id}`;
        expect(k?.status).toBe("draft");
      }
    }
    hasFlow = false;
  });
});

describe("CR-127 Q1 · tách quyền + cách ly tenant của lượt duyệt", () => {
  it("Q1-AC4a · viewer không Xác nhận & lưu / Gửi được (403); tenant khác ⇒ 404 như không có; HĐ không đổi", async () => {
    hasFlow = true;
    const { s } = await fresh();
    const before = await snapshot(c.sql, s.id);
    const r = [
      await reviewOf(c, s.id, { version: 1 }, P.tam),
      await call(c, P.tam, "POST", `/contracts/${s.id}/submit`, {}),
      await reviewOf(c, s.id, { version: 1 }, P.an),
      await call(c, P.an, "POST", `/contracts/${s.id}/submit`, {}),
    ];
    expect(r.map((x) => x.status)).toEqual([403, 403, 404, 404]);
    expect(await snapshot(c.sql, s.id)).toEqual(before);
    expect(await runsOf(s.id)).toBe(0);
    hasFlow = false;
  });

  it("Q1-AC4b · chỉ người gửi được Rút về: người khác ⇒ 409 WITHDRAW_NOT_ALLOWED (not_submitter), lượt vẫn mở; tenant khác ⇒ 404", async () => {
    hasFlow = true;
    const { s } = await fresh();
    const sent = await reviewOf(c, s.id, { version: 1 });
    expect(sent.json?.status).toBe("processing");
    const other = await call(c, P.lan, "POST", `/contracts/${s.id}/withdraw`, { reason: "thử" });
    expect([other.status, other.json?.error?.code]).toEqual([409, "WITHDRAW_NOT_ALLOWED"]);
    expect(other.json?.error?.details?.why ?? other.json?.why).toBe("not_submitter");
    const foreign = await call(c, P.an, "POST", `/contracts/${s.id}/withdraw`, { reason: "thử" });
    expect(foreign.status).toBe(404);
    const [k] = await c.sql<
      { status: string }[]
    >`select status from contracts.contracts where id = ${s.id}`;
    expect(k?.status).toBe("processing");
    expect(await runsOf(s.id)).toBe(1);
    hasFlow = false;
  });
});
