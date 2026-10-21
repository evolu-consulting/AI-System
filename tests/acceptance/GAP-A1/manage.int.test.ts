// gap-a1 · trang chi tiết HĐ qua hub-api THẬT (AI chỉ là nhà cung cấp GIẢ tất định): giao người phụ trách (#7), lịch sử (#4), hoa hồng % sau khi
// lưu (#16), tóm tắt bằng AI (#17). Mỗi endpoint một ca đường chính + chặn đọc/ghi chéo (viewer ⇒ 403, tenant khác ⇒ 404). "AI đọc lại" (#5)
// dùng lại route `POST /extract` đã có test HD2.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { arrangeV2a, type CtxN1, call, type Json, P, seedReview, T } from "../V2-G/_support/v2g";
import { type CtxJ2, startJ2 } from "../V2-J2/_support/v2j2";

let c: CtxJ2;
beforeAll(async () => {
  c = await startJ2();
}, 120_000);
afterAll(async () => {
  await c?.stop();
});

const SUMMARY = {
  main: "Hợp đồng giới thiệu khách hàng, hoa hồng theo doanh thu.",
  deadlines: ["Thanh toán trước 15/02"],
  penalties: [],
  bonuses: ["Hoa hồng 5%"],
  clauses: ["Điều 3: bảo mật"],
};
const as = (p: (typeof P)[keyof typeof P], m: string, path: string, body?: unknown) =>
  call(c as CtxN1, p, m, path, body);
const row = async (id: string) => {
  const [r] = await c.sql<
    Json[]
  >`select owner_user_id::text as owner, commission_pct::float as pct, version,
    ai_read->'summary' as summary from contracts.contracts where id = ${id}`;
  return r as Json;
};

describe("gap-a1 · giao người phụ trách + lịch sử", () => {
  it("giao cho người có quyền xem ghi event; người không có quyền ⇒ 422; viewer ⇒ 403; tenant khác ⇒ 404; lịch sử thấy event", async () => {
    await arrangeV2a(c);
    const s = await seedReview(c, 1, { deal: "sell" });
    const list = await as(P.hoa, "GET", "/assignees");
    expect(list.status).toBe(200);
    const ids = list.json.items.map((x: Json) => x.id);
    expect(ids).toContain(P.tam.id);
    expect(ids).not.toContain(P.cuc.id); // thành viên tenant nhưng không thuộc nhóm nào của gói

    const ok = await as(P.hoa, "PUT", `/contracts/${s.id}/owner`, { owner_user_id: P.tam.id });
    expect([ok.status, ok.json]).toEqual([200, { id: s.id, owner_user_id: P.tam.id }]);
    expect((await row(s.id)).owner).toBe(P.tam.id);
    const bad = await as(P.hoa, "PUT", `/contracts/${s.id}/owner`, { owner_user_id: P.cuc.id });
    expect([bad.status, bad.json.error?.code ?? bad.json.code]).toEqual([422, "OWNER_INVALID"]);
    expect(
      (await as(P.tam, "PUT", `/contracts/${s.id}/owner`, { owner_user_id: null })).status,
    ).toBe(403);
    expect(
      (await as(P.an, "PUT", `/contracts/${s.id}/owner`, { owner_user_id: null })).status,
    ).toBe(404);
    expect((await row(s.id)).owner).toBe(P.tam.id); // lần lỗi không ghi gì

    const h = await as(P.tam, "GET", `/contracts/${s.id}/history`);
    expect(h.status).toBe(200);
    expect(h.json.items[0]).toMatchObject({
      type: "owner_assigned",
      actor_user_id: P.hoa.id,
      data: { from: P.hoa.id, to: P.tam.id },
    });
    expect((await as(P.an, "GET", `/contracts/${s.id}/history`)).status).toBe(404);
  });
});

describe("gap-a1 · sửa hoa hồng % sau khi lưu", () => {
  it("HĐ Giới thiệu: đổi % + event, version+1; version cũ ⇒ 409; không phải Giới thiệu ⇒ 422; viewer 403; tenant khác 404", async () => {
    await arrangeV2a(c);
    const r = await seedReview(c, 2, { deal: "referral" });
    await c.sql`update contracts.contracts set commission_pct = 5, status = 'active' where id = ${r.id}`;
    const v = (await row(r.id)).version;
    const ok = await as(P.hoa, "PUT", `/contracts/${r.id}/commission`, {
      version: v,
      commission_pct: 7.5,
    });
    expect([ok.status, ok.json.commission_pct, ok.json.version]).toEqual([200, 7.5, v + 1]);
    expect((await row(r.id)).pct).toBe(7.5);
    const [ev] = await c.sql<Json[]>`select data from contracts.contract_events
      where contract_id = ${r.id} and type = 'commission_edited'`;
    expect(ev?.data).toEqual({ from: 5, to: 7.5 });
    expect(
      (await as(P.hoa, "PUT", `/contracts/${r.id}/commission`, { version: v, commission_pct: 1 }))
        .status,
    ).toBe(409);
    expect(
      (
        await as(P.hoa, "PUT", `/contracts/${r.id}/commission`, {
          version: v + 1,
          commission_pct: 101,
        })
      ).status,
    ).toBe(400);
    const sell = await seedReview(c, 3, { deal: "sell" });
    expect(
      (
        await as(P.hoa, "PUT", `/contracts/${sell.id}/commission`, {
          version: 1,
          commission_pct: 1,
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await as(P.tam, "PUT", `/contracts/${r.id}/commission`, {
          version: v + 1,
          commission_pct: 2,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await as(P.an, "PUT", `/contracts/${r.id}/commission`, {
          version: v + 1,
          commission_pct: 2,
        })
      ).status,
    ).toBe(404);
    expect((await row(r.id)).pct).toBe(7.5);
  });
});

describe("gap-a1 · Tạo tóm tắt bằng AI", () => {
  it("tạo tóm tắt, ghi ai_read + usage `contracts.summary`; lần 2 ⇒ 409; AI rác ⇒ 503 không ghi; viewer 403; tenant khác 404", async () => {
    await arrangeV2a(c);
    const s = await seedReview(c, 4, { deal: "referral" });
    await c.sql`update contracts.contracts set source_text = 'Hợp đồng giới thiệu khách hàng. Hoa hồng 5%.' where id = ${s.id}`;
    await c.sql`delete from hub.usage_logs where tenant_id = ${T.acme} and feature = 'contracts.summary'`;

    c.ai.next = { text: "không phải JSON" };
    expect((await as(P.hoa, "POST", `/contracts/${s.id}/summary`)).status).toBe(503);
    expect((await row(s.id)).summary).toBeNull();

    c.ai.next = { text: JSON.stringify(SUMMARY) };
    const ok = await as(P.hoa, "POST", `/contracts/${s.id}/summary`);
    expect([ok.status, ok.json.summary]).toEqual([200, SUMMARY]);
    expect((await row(s.id)).summary).toEqual(SUMMARY);
    // văn bản HĐ chỉ đi trong thẻ dữ liệu có nonce
    expect(c.ai.calls.at(-1)?.prompt).toMatch(/<contract_text_[a-z0-9]{8,}>/);
    const [u] = await c.sql<{ n: number }[]>`select count(*)::int as n from hub.usage_logs
      where tenant_id = ${T.acme} and feature = 'contracts.summary' and user_id = ${P.hoa.id}`;
    expect(u?.n).toBe(2); // một lượt lỗi parse vẫn tính usage + một lượt thành công
    expect((await as(P.hoa, "POST", `/contracts/${s.id}/summary`)).status).toBe(409);
    expect((await as(P.tam, "POST", `/contracts/${s.id}/summary`)).status).toBe(403);
    expect((await as(P.an, "POST", `/contracts/${s.id}/summary`)).status).toBe(404);
    const d = await as(P.tam, "GET", `/contracts/${s.id}`);
    expect(d.json.ai.summary).toEqual(SUMMARY);
  });
});
