// V2-G · BA v2 §3.1 HD-02/HD-08 · §4.2 "Upload và xác nhận" · §5.5a · C3 · C12: "Lưu" ở màn xác nhận (`POST /contracts/:id/review`) qua
// hub-api THẬT — MỘT tx lưu trường + loại + dòng hàng (+ SP) + mốc; tenant tắt duyệt ⇒ `active` ngay (V2-A để ngỏ); bật duyệt ⇒ còn
// `needs_review`. "Hủy" không có lệnh API (màn hình bỏ bản nháp ⇒ e2e kiểm không có yêu cầu ghi); ở đây: Lưu LỖI không ghi gì.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  arrangeV2a,
  type CtxN1,
  call,
  d,
  detail,
  itemRows,
  type Json,
  makeProduct,
  needV2g,
  P,
  restoreApproval,
  reviewOf,
  rowsOf,
  seedReview,
  setApproval,
  snapshot,
  startHd1,
  T,
} from "./_support/v2g";

let c: CtxN1;
beforeAll(async () => {
  c = await startHd1();
  await needV2g(c.sql);
}, 120_000);
afterAll(async () => {
  if (c) await restoreApproval(c.sql);
  await c?.stop();
});

const AI = (over: Json = {}) => ({
  deal: "sell",
  unsure: ["end_date", "deal"],
  summary: null,
  milestones: [],
  ...over,
});
async function arrange(approval: boolean) {
  await arrangeV2a(c);
  await setApproval(c.sql, T.acme, approval);
  await c.sql`truncate contracts.products cascade`;
}
const MS = [
  { kind: "delivery", title: "Giao lô đầu", due_date: d(12) },
  { kind: "collect", title: "Thu đợt 1", due_date: d(30), amount: 40_000_000 },
  { kind: "collect", due_date: d(60), amount: 60_000_000 },
];
const pick = (m: Json) => [m.kind, m.owner, m.title, m.due_date, m.amount_effective, m.source];

describe("V2-G · Lưu ở tenant TẮT duyệt ⇒ active ngay (HD-01 · C3)", () => {
  it("lưu trường + loại + dòng (sửa/thêm) + mốc người đã xem; active, confirmed, version+1, một sự kiện review_saved", async () => {
    await arrange(false);
    const s = await seedReview(c, 1, {
      deal: "sell",
      ai: AI(),
      items: [
        { name: "USB token", qty: 10, unit_price: 200_000, unit: "cái" },
        { name: "Dòng AI đọc nhầm", qty: 1, unit_price: 1 },
      ],
    });
    const tok = await makeProduct(c, P.hoa, { name: "Chữ ký số DN – USB Token", group: "goods" });
    const r = await reviewOf(c, s.id, {
      version: 1,
      fields: { title: "HĐ đã xác nhận", total_value: 150_000_000 },
      items: [
        {
          id: s.items[0],
          name: "USB token",
          qty: 12,
          unit_price: 190_000,
          unit: "cái",
          product_id: tok.id,
          component_ids: tok.comps,
        },
        { id: s.items[1], name: "Dòng AI đọc nhầm", qty: 1, unit_price: 1 },
        { name: "Phí cài đặt", qty: 1, unit_price: 500_000 },
      ],
      milestones: MS,
    });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ id: s.id, status: "active", version: 2, items: 3, milestones: 3 });

    const x = await detail(c, s.id);
    expect([x.status, x.version, x.deal, x.direction]).toEqual(["active", 2, "sell", "sale"]);
    expect(x.confirmed_by).toBe(P.hoa.id);
    expect(x.confirmed_at).not.toBeNull();
    expect(x.fields.title).toMatchObject({ value: "HĐ đã xác nhận", edited: true, verified: true });
    expect(x.fields.total_value.value).toBe(150_000_000);
    expect(
      x.items.map((i: Json) => [i.name, i.qty, i.unit_price, i.product_id, i.component_ids]),
    ).toEqual([
      ["USB token", 12, 190_000, tok.id, tok.comps],
      ["Dòng AI đọc nhầm", 1, 1, null, null],
      ["Phí cài đặt", 1, 500_000, null, null],
    ]);
    // dòng đổi ⇒ edited; dòng không đổi ⇒ vẫn của AI (edited=false)
    expect((await itemRows(c.sql, s.id)).map((i) => i.edited)).toEqual([true, false, true]);
    // Mốc = đúng bộ người gửi (nguồn `ai`), KHÔNG thêm đợt mặc định của HD7 (trigger thấy mốc đã ghi); 5.4a: mốc trống ⇒ phần còn lại.
    expect(x.milestones.map(pick)).toEqual([
      ["delivery", "ours", "Giao lô đầu", d(12), null, "ai"],
      ["collect", "partner", "Thu đợt 1", d(30), 40_000_000, "ai"],
      ["collect", "partner", "Thu tiền", d(60), 60_000_000, "ai"],
    ]);
    const ev = await c.sql<
      { type: string; data: Json }[]
    >`select type, data from contracts.contract_events
      where contract_id = ${s.id} and type = 'review_saved'`;
    expect(ev).toHaveLength(1);
    expect(ev[0]?.data).toMatchObject({ deal: "sell", status: "active", items: 3, milestones: 3 });
    expect(ev[0]?.data.fields).toEqual(["title", "total_value"]);
  });

  it("không gửi mốc ⇒ mốc mặc định theo loại (Giao + Thu tiền theo ngày HĐ), nguồn default", async () => {
    await arrange(false);
    const s = await seedReview(c, 1, { deal: "sell", ai: AI() });
    const r = await reviewOf(c, s.id, { version: 1 });
    expect(r.json).toMatchObject({ status: "active", milestones: 2 });
    const x = await detail(c, s.id);
    expect(x.milestones.map(pick)).toEqual([
      ["delivery", "ours", "Giao hàng", d(10), null, "default"],
      ["collect", "partner", "Thu tiền", d(40), 100_000_000, "default"],
    ]);
  });

  it("đổi Bán → Mua: hướng purchase, mốc theo loại mới (đối tác = bên bán), HD7 không sinh thêm đợt", async () => {
    await arrange(false);
    const s = await seedReview(c, 1, { deal: "sell", ai: AI() });
    const r = await reviewOf(c, s.id, {
      version: 1,
      deal: "buy",
      milestones: [{ kind: "pay", due_date: d(20), amount: 5_000_000 }],
    });
    expect(r.status).toBe(200);
    const x = await detail(c, s.id);
    expect([x.deal, x.direction]).toEqual(["buy", "purchase"]);
    const rows = await rowsOf(c.sql, s.id);
    expect(rows.map((m) => [m.kind, m.direction, m.owner, m.amount])).toEqual([
      ["payment", "pay", "ours", "5000000"],
    ]);
    const [p] = await c.sql<
      { party_key: string; seller: string; buyer: string }[]
    >`select o.party_key,
        contracts.party_key(c.fields -> 'supplier_name' ->> 'value', null) as seller,
        contracts.party_key(c.fields -> 'buyer_name' ->> 'value', null) as buyer
      from contracts.obligations o join contracts.contracts c on c.id = o.contract_id where o.contract_id = ${s.id}`;
    expect(p?.party_key).toBe(p?.seller); // đối tác = bên bán khi mình MUA (ngược với Bán)
    expect(p?.party_key).not.toBe(p?.buyer);
  });

  it("Giới thiệu + hoa hồng: đối tác phía bên mua; mốc Nhận hoa hồng; hoa hồng cũ bị bỏ khi đổi sang loại khác", async () => {
    await arrange(false);
    const s = await seedReview(c, 1, { deal: "sell", ai: AI({ deal: "referral" }) });
    const r = await reviewOf(c, s.id, { version: 1, deal: "referral", commission_pct: 12.5 });
    expect(r.status).toBe(200);
    const x = await detail(c, s.id);
    expect([x.deal, x.direction, x.commission_pct, x.commission_fixed]).toEqual([
      "referral",
      "sale",
      12.5,
      null,
    ]);
    expect(x.milestones.map((m: Json) => [m.kind, m.amount_effective])).toEqual([
      ["commission", 12_500_000],
    ]);
  });

  it("lượt duyệt đang mở (level1) được đóng `done` khi tenant tắt duyệt", async () => {
    await arrange(false);
    const s = await seedReview(c, 1, { deal: "sell", ai: AI() });
    const [a] = await c.sql<
      { id: string }[]
    >`insert into contracts.approvals (tenant_id, contract_id, status, started_by)
      values (${T.acme}, ${s.id}, 'level1', ${P.hoa.id}) returning id`;
    await c.sql`update contracts.contracts set run_id = ${a?.id as string} where id = ${s.id}`;
    expect((await reviewOf(c, s.id, { version: 1 })).status).toBe(200);
    const [x] = await c.sql<
      { status: string; decided_by: string }[]
    >`select status, decided_by::text from contracts.approvals
      where id = ${a?.id as string}`;
    expect(x).toEqual({ status: "done", decided_by: P.hoa.id });
  });
});

describe("V2-G · Lưu ở tenant BẬT duyệt ⇒ vẫn needs_review (còn bước Xác nhận)", () => {
  it("lưu mốc (nguồn ai, chưa tính nợ/quá hạn vì HĐ chưa được duyệt); Lưu lần hai THAY bộ mốc cũ", async () => {
    await arrange(true);
    const s = await seedReview(c, 1, {
      deal: "sell",
      ai: AI(),
      items: [{ name: "Hàng", qty: 1, unit_price: 1 }],
    });
    const r1 = await reviewOf(c, s.id, { version: 1, milestones: MS });
    expect(r1.json).toMatchObject({ status: "needs_review", version: 2, milestones: 3 });
    const x = await detail(c, s.id);
    expect([x.status, x.confirmed_at, x.milestones.length]).toEqual(["needs_review", null, 3]);
    // Hạn trong quá khứ: HĐ chưa duyệt ⇒ vòng quá hạn không ghi sổ cho mốc này (confirmedOf).
    const r2 = await reviewOf(c, s.id, {
      version: 2,
      milestones: [{ kind: "delivery", title: "Giao một lần", due_date: d(-5) }],
    });
    expect(r2.json).toMatchObject({ status: "needs_review", version: 3, milestones: 1 });
    const live = (await rowsOf(c.sql, s.id)).filter((m) => m.status !== "replaced");
    expect(live.map((m) => [m.kind, m.title])).toEqual([["delivery", "Giao một lần"]]);
    expect((await rowsOf(c.sql, s.id)).filter((m) => m.status === "replaced")).toHaveLength(3);
    const [ev] = await c.sql<
      { n: number }[]
    >`select count(*)::int as n from contracts.partner_events where contract_id = ${s.id}`;
    expect(ev?.n).toBe(0);
  });

  it("không gửi mốc ⇒ không đụng; Lưu không đổi trạng thái; viewer không Lưu được", async () => {
    await arrange(true);
    const s = await seedReview(c, 1, { deal: "buy", ai: AI() });
    expect((await reviewOf(c, s.id, { version: 1 })).json).toMatchObject({
      status: "needs_review",
      milestones: 0,
    });
    expect((await rowsOf(c.sql, s.id)).length).toBe(0);
    expect((await reviewOf(c, s.id, { version: 2 }, P.tam)).status).toBe(403);
  });
});

describe("V2-G · lỗi ⇒ không ghi gì (một tx)", () => {
  async function failsWithoutWriting(body: Json, status: number, code?: string) {
    await arrange(false);
    const s = await seedReview(c, 1, {
      deal: "sell",
      ai: AI(),
      items: [{ name: "Hàng", qty: 1, unit_price: 1 }],
    });
    const before = await snapshot(c.sql, s.id);
    const r = await reviewOf(c, s.id, body);
    expect(r.status).toBe(status);
    if (code) expect(r.json.error.code).toBe(code);
    expect(await snapshot(c.sql, s.id)).toEqual(before);
    return r;
  }

  it("mốc có số tiền sai loại (Giao hàng) ⇒ 422 MILESTONE_INVALID", async () => {
    await failsWithoutWriting(
      {
        version: 1,
        fields: { title: "Đổi tên" },
        milestones: [{ kind: "delivery", due_date: d(1), amount: 5 }],
      },
      422,
      "MILESTONE_INVALID",
    );
  });
  it("SP của tenant khác / không có ⇒ 422 PRODUCT_INVALID", async () => {
    await arrange(false);
    const theirs = await makeProduct(c, P.an, { name: "SP beta", group: "goods" });
    for (const product_id of [theirs.id, "e1000000-0000-4000-8000-0000000000ff"]) {
      const s = await seedReview(c, 1, {
        deal: "sell",
        ai: AI(),
        items: [{ name: "Hàng", qty: 1 }],
      });
      const before = await snapshot(c.sql, s.id);
      const r = await reviewOf(c, s.id, {
        version: 1,
        fields: { title: "x" },
        items: [{ id: s.items[0], name: "Hàng", product_id }],
        milestones: MS,
      });
      expect([r.status, r.json.error.code]).toEqual([422, "PRODUCT_INVALID"]);
      expect(await snapshot(c.sql, s.id)).toEqual(before);
      await c.sql`delete from contracts.contract_items where contract_id = ${s.id}`;
      await c.sql`delete from contracts.contracts where id = ${s.id}`;
    }
  });
  it("thành phần không thuộc SP đã chọn ⇒ 422 PRODUCT_INVALID", async () => {
    await arrange(false);
    const a = await makeProduct(c, P.hoa, { name: "SP A", group: "goods" });
    const b = await makeProduct(c, P.hoa, { name: "SP B", group: "goods" });
    const s = await seedReview(c, 1, { deal: "sell", ai: AI(), items: [{ name: "Hàng", qty: 1 }] });
    const before = await snapshot(c.sql, s.id);
    const r = await reviewOf(c, s.id, {
      version: 1,
      items: [{ id: s.items[0], name: "Hàng", product_id: a.id, component_ids: b.comps }],
    });
    expect([r.status, r.json.error.code]).toEqual([422, "PRODUCT_INVALID"]);
    expect(await snapshot(c.sql, s.id)).toEqual(before);
  });
  it("dòng `id` không thuộc HĐ này ⇒ 422, rollback cả trường đã sửa", async () => {
    await arrange(false);
    const other = await seedReview(c, 2, { deal: "sell", items: [{ name: "Của HĐ khác" }] });
    const s = await seedReview(c, 1, { deal: "sell", ai: AI(), items: [{ name: "Hàng", qty: 1 }] });
    const before = await snapshot(c.sql, s.id);
    const r = await reviewOf(c, s.id, {
      version: 1,
      fields: { title: "Không được ghi" },
      items: [{ id: other.items[0], name: "Mượn dòng người khác" }],
    });
    expect(r.status).toBe(422);
    expect(await snapshot(c.sql, s.id)).toEqual(before);
    expect((await itemRows(c.sql, other.id))[0]?.name).toBe("Của HĐ khác");
  });
  it("hoa hồng cho HĐ Bán ⇒ 422; version lệch ⇒ 409 CONTRACT_STALE {current.version}", async () => {
    await failsWithoutWriting({ version: 1, deal: "sell", commission_pct: 5 }, 422);
    const r = await failsWithoutWriting(
      { version: 7, fields: { title: "x" } },
      409,
      "CONTRACT_STALE",
    );
    expect(r.json.error.details.current.version).toBe(1);
  });
  it("HĐ không còn chờ xác nhận (đã active / đang đọc / bị từ chối) ⇒ 409 REVIEW_NOT_ALLOWED", async () => {
    for (const status of ["active", "extracting", "rejected"]) {
      await arrange(false);
      const s = await seedReview(c, 1, { deal: "sell", status });
      const before = await snapshot(c.sql, s.id);
      const r = await reviewOf(c, s.id, { version: 1, fields: { title: "x" } });
      expect([status, r.status, r.json.error.code]).toEqual([status, 409, "REVIEW_NOT_ALLOWED"]);
      expect(await snapshot(c.sql, s.id)).toEqual(before);
    }
  });
  it("tenant khác ⇒ 404 như không có; id sai dạng ⇒ 400; thân có khoá lạ ⇒ 400", async () => {
    await arrange(false);
    const s = await seedReview(c, 1, { deal: "sell" });
    expect((await reviewOf(c, s.id, { version: 1 }, P.an)).status).toBe(404);
    expect(
      (await call(c, P.hoa, "POST", "/contracts/khong-phai-uuid/review", { version: 1 })).status,
    ).toBe(400);
    expect((await reviewOf(c, s.id, { version: 1, tenant_id: T.beta })).status).toBe(400);
    expect((await reviewOf(c, s.id, { version: 1, fields: { khong_co: 1 } })).status).toBe(400);
  });
});

describe("V2-G · chi tiết trả product_id / component_ids từng dòng + `ai`", () => {
  it("dòng đã gắn trả id SP + thành phần; HĐ nhập tay không có `ai`", async () => {
    await arrange(false);
    const tok = await makeProduct(c, P.hoa, { name: "USB Token", group: "goods" });
    const out = await call(c, P.hoa, "POST", "/contracts/manual", {
      title: "HĐ tay",
      partner_name: "ĐT",
      deal: "sell",
      items: [
        { name: "Token", qty: 1, unit_price: 1, product_id: tok.id, component_ids: tok.comps },
        { name: "Chưa gắn" },
      ],
    });
    const x = await detail(c, out.json.id);
    expect(x.items.map((i: Json) => [i.product_id, i.component_ids])).toEqual([
      [tok.id, tok.comps],
      [null, null],
    ]);
    expect(x.ai).toBeNull();
  });
});
