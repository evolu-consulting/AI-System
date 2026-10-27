// MS-impact · CR-101b (R18, R19, R34; Câu 11) · làn đầy đủ: xem trước tác động xác nhận mốc qua hub-api thật.
// Đường chính: `GET /obligations/:id/impact` KHÔNG ghi; `settle` lưu delta khớp xem trước; bảng điểm sau xác nhận = "sau" của xem trước;
// chi tiết HĐ đọc `rep_delta`. Câu 11: lỗi "Chưa rõ" ⇒ việc "Xác minh lỗi mốc trễ" sau 3 ngày. REP-v3 mục 7: "Đánh giá đối tác" theo cờ.
// Chéo tenant: tenant khác ⇒ 404. Cờ `REPUTATION_ENGINE` đọc mỗi yêu cầu.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import {
  arrangeV2e,
  type CtxN1,
  call,
  contract,
  d,
  type Json,
  milestones,
  ok,
  P,
  startHd1,
  T,
} from "../V2-E/_support/v2e";

let c: CtxN1;
beforeAll(async () => {
  c = await startHd1();
}, 120_000);
afterAll(async () => {
  delete process.env.REPUTATION_ENGINE;
  await c?.stop();
});
afterEach(() => {
  delete process.env.REPUTATION_ENGINE;
});
const on = () => {
  process.env.REPUTATION_ENGINE = "v2e";
};

const A = "tax:0309000001";
/** NCC A dịch vụ (V2-E 94 TỐT như REP-v3) + một mốc giao MỞ hạn 30 ngày trước (lỗi đối tác ⇒ việc 40 điểm ⇒ 94 → 85). */
async function world(): Promise<{ k: string; m: string }> {
  await arrangeV2e(c);
  const k = await contract(c.sql, {
    deal: "buy",
    tax: "0309000001",
    name: "NCC An",
    group: "service",
  });
  await milestones(c.sql, k, A, [
    { kind: "delivery", done: -60, late: 5, fault: "partner" },
    { kind: "delivery", done: -240, late: 10, fault: "partner" },
    { kind: "delivery", done: -420, late: 3, fault: "ours" },
    { kind: "serial", done: -30 },
  ]);
  const [r] = await c.sql<
    { id: string }[]
  >`insert into contracts.obligations (tenant_id, contract_id, party_key,
      direction, kind, seq, due_date, status, owner, title)
    values (${T.acme}, ${k}, ${A}, 'pay', 'delivery', 9, ${d(-30)}, 'open', 'partner', 'Giao đợt cuối') returning id::text`;
  return { k, m: (r as { id: string }).id };
}
const writes = async () => {
  const [n] = await c.sql<
    { n: number }[]
  >`select (select count(*) from contracts.partner_events)::int
    + (select count(*) from contracts.obligations where status = 'done')::int as n`;
  return n?.n;
};
const impact = (m: string, q: string, p = P.hoa) =>
  call(c, p, "GET", `/obligations/${m}/impact${q}`);

describe("MS-impact · xem trước + xác nhận (cờ v2e)", () => {
  it("xem trước không ghi; settle lưu delta khớp; bảng điểm + chi tiết HĐ đọc đúng số", async () => {
    const { k, m } = await world();
    on();
    const before = await writes();
    const pv = await ok(impact(m, `?fault=partner&actual_on=${d(0)}`));
    expect([pv.late, pv.fault, pv.debt, pv.stock]).toEqual([30, "partner", null, []]);
    const rep = pv.reputation;
    expect([rep.engine, rep.role, rep.party, rep.counted, rep.pending_fault]).toEqual([
      "v2e",
      "supplier",
      A,
      true,
      false,
    ]);
    expect(rep.before).toEqual({ score: 94, level: "good" });
    expect(rep.after.score).toBeLessThan(94);
    expect(await writes()).toBe(before); // KHÔNG ghi
    // Lỗi mình ⇒ không trừ; chưa rõ ⇒ cờ nhắc xác minh.
    const ours = await ok(impact(m, `?fault=ours&actual_on=${d(0)}`));
    expect(ours.reputation.after.score).toBeGreaterThanOrEqual(rep.after.score);
    expect((await ok(impact(m, `?actual_on=${d(0)}`))).reputation.pending_fault).toBe(true);

    await ok(call(c, P.hoa, "POST", `/obligations/${m}/settle`, { at: d(0), fault: "partner" }));
    const [ev] = await c.sql<
      { impact: Json }[]
    >`select data -> 'impact' as impact from contracts.partner_events
      where obligation_id = ${m} and type = 'delivered'`;
    expect(ev?.impact).toEqual({
      engine: "v2e",
      role: "supplier",
      before: rep.before,
      after: rep.after,
    });
    const row = (await ok(call(c, P.hoa, "GET", "/reputation/partners?role=supplier"))).find(
      (r: Json) => r.party === A,
    );
    expect([row.score, row.level]).toEqual([rep.after.score, rep.after.level]);
    const detail = await ok(call(c, P.hoa, "GET", `/contracts/${k}`));
    const ms = detail.milestones.find((x: Json) => x.id === m);
    expect(ms.rep_delta).toEqual(ev?.impact);
    // Đợt đã xong ⇒ 409.
    expect((await impact(m, "")).status).toBe(409);
  });

  it("cờ tắt (hd8): engine hd8, không ghi; tham số sai ⇒ 400; tenant khác ⇒ 404", async () => {
    const { m } = await world();
    const before = await writes();
    const pv = await ok(impact(m, `?fault=partner&actual_on=${d(0)}`));
    expect([pv.reputation.engine, pv.reputation.role, pv.reputation.counted]).toEqual([
      "hd8",
      "supplier",
      true,
    ]);
    expect(await writes()).toBe(before);
    expect((await impact(m, "?fault=nobody")).status).toBe(400);
    expect((await impact(m, "", P.an)).status).toBe(404);
  });
});

describe("MS-impact · Cần xử lý", () => {
  const todo = async () => (await ok(call(c, P.hoa, "GET", "/my-work/todo"))).items as Json[];

  it("Câu 11: lỗi «Chưa rõ» ⇒ «Xác minh lỗi mốc trễ» sau 3 ngày (2 ngày ⇒ chưa); Bỏ qua ⇒ ẩn", async () => {
    await arrangeV2e(c);
    const k = await contract(c.sql, { deal: "buy", tax: "0309000002", group: "goods" });
    await milestones(c.sql, k, "tax:0309000002", [
      { kind: "delivery", done: -3, late: 4, fault: "unknown" },
      { kind: "delivery", done: -2, late: 4, fault: "unknown" },
      { kind: "delivery", done: -5, late: 4, fault: "partner" },
    ]);
    const items = (await todo()).filter((i) => i.kind === "verify_fault");
    expect(items.map((i) => [i.title, i.days, i.due])).toEqual([["Mốc 1", 0, d(0)]]);
    await ok(
      call(c, P.hoa, "POST", "/my-work/todo/dismiss", { key: items[0]?.key, action: "done" }),
    );
    expect((await todo()).some((i) => i.kind === "verify_fault")).toBe(false);
  });

  it("REP-v3 mục 7: «Đánh giá đối tác» sau HĐ chỉ khi cờ v2e", async () => {
    await arrangeV2e(c);
    const k = await contract(c.sql, { deal: "buy", tax: "0309000003", group: "service" });
    await milestones(c.sql, k, "tax:0309000003", [{ kind: "delivery", done: -5 }]);
    expect((await todo()).some((i) => i.kind === "rating")).toBe(false);
    on();
    const r = (await todo()).find((i) => i.kind === "rating");
    expect([r?.contract_id, r?.party_key, r?.due]).toEqual([k, "tax:0309000003", d(-5)]);
  });
});
