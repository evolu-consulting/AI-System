// V2-G · HD-02/HD-08 · BA §4.2: luật thuần màn xác nhận sau AI đọc — form điền sẵn, ô tô vàng, đổi Mua↔Bán, mốc AI, thân /review.
import { describe, expect, it } from "bun:test";
import { type LineState, readNumbers } from "./form-model";
import {
  dealUnsure,
  fallbackDue,
  formOfConfirm,
  lineOfItem,
  msRowsOf,
  reviewMilestones,
  reviewRequest,
  switchDeal,
  unsureKeys,
} from "./review-model";

const f = (value: string | number | null, o: Record<string, unknown> = {}) => ({
  value,
  quote: "",
  verified: true,
  edited: false,
  ...o,
});
const U = "e1000000-0000-4000-8000-000000000001";
const P = "e1000000-0000-4000-8000-0000000000aa";
// biome-ignore lint/suspicious/noExplicitAny: dòng thử rút gọn của ContractItem
const item = (o: Record<string, unknown> = {}): any => ({
  id: U,
  ord: 0,
  name: "USB",
  unit: "cái",
  qty: 100,
  unit_price: 250_000,
  product_id: null,
  component_ids: null,
  ...o,
});
const detail = (o: Record<string, unknown> = {}) =>
  ({
    version: 3,
    deal: "sell",
    direction: "sale",
    commission_pct: null,
    commission_fixed: null,
    fields: {
      title: f("HĐ bán"),
      number: f("01"),
      supplier_name: f("Cty A"),
      supplier_tax_id: f(null),
      buyer_name: f("Cty B"),
      buyer_tax_id: f(null),
      supplier_representative: f("Ông A"),
      buyer_representative: f("Bà B"),
      start_date: f("2026-01-01"),
      end_date: f("2026-12-31"),
      notice_days: f(30),
      total_value: f(1000),
      payment_terms: f("30 ngày", { verified: false }),
    },
    ai: {
      deal: "sell",
      unsure: ["deal", "buyer_name"],
      summary: null,
      milestones: [
        {
          kind: "delivery",
          title: "Giao",
          due_date: "2026-03-01",
          amount: null,
          quote: "q",
          verified: true,
        },
        { kind: "collect", title: null, due_date: null, amount: 500, quote: "q2", verified: false },
        {
          kind: "other",
          title: "Khác",
          due_date: "2026-04-01",
          amount: 9,
          quote: "",
          verified: true,
        },
      ],
    },
    items: [item()],
    ...o,
    // biome-ignore lint/suspicious/noExplicitAny: dữ liệu thử rút gọn của ContractDetail
  }) as any;

describe("form xác nhận", () => {
  it("điền sẵn từ fields + dòng hàng đã đọc (giữ id, SP, thành phần)", () => {
    const form = formOfConfirm(detail({ items: [item({ product_id: P, component_ids: [U] })] }));
    expect([form.deal, form.partner_name, form.title]).toEqual(["sell", "Cty B", "HĐ bán"]);
    expect(form.items[0]).toMatchObject({
      id: U,
      name: "USB",
      qty: "100",
      product_id: P,
      component_id: U,
    });
    expect(lineOfItem(item()).product_id).toBe("");
  });
});

describe("ô tô vàng", () => {
  it("AI chưa chắc hoặc trích dẫn không kiểm chứng được ⇒ vàng; sửa tay hoặc người đã đổi giá trị ⇒ hết", () => {
    const d = detail();
    const form = formOfConfirm(d);
    expect([...unsureKeys(d, form)].sort()).toEqual(["partner_name", "payment_terms"]);
    expect(unsureKeys(d, { ...form, partner_name: "Cty khác" }).has("partner_name")).toBe(false);
    const edited = detail();
    edited.fields.payment_terms.edited = true;
    expect(unsureKeys(edited, form).has("payment_terms")).toBe(false);
  });
  it("loại HĐ vàng khi AI chưa chắc và người chưa đổi", () => {
    const d = detail();
    const form = formOfConfirm(d);
    expect(dealUnsure(d, form)).toBe(true);
    expect(dealUnsure(d, { ...form, deal: "buy" })).toBe(false);
    expect(dealUnsure(detail({ ai: { ...d.ai, unsure: [] } }), form)).toBe(false);
  });
});

describe("đổi loại Mua ↔ Bán", () => {
  it("dựng lại đối tác + người ký theo phía mới; PATCH không thấy đổi ảo; bỏ chọn SP", async () => {
    const d = detail();
    const form = formOfConfirm({ ...d, items: [item({ product_id: P })] });
    const bought = switchDeal(d, form, "buy");
    expect([bought.deal, bought.partner_name, bought.partner_signer, bought.our_signer]).toEqual([
      "buy",
      "Cty A",
      "Ông A",
      "Bà B",
    ]);
    expect(bought.items[0]?.product_id).toBe("");
    const { patchOfForm } = await import("./detail-form");
    expect(patchOfForm(d, bought)).toEqual({});
  });
});

describe("mốc AI tìm thấy", () => {
  it("hạn trống ⇒ ngày kết thúc ?? bắt đầu ?? hôm nay", () => {
    expect(fallbackDue({ end_date: "2026-12-31", start_date: "2026-01-01" }, "2026-10-18")).toBe(
      "2026-12-31",
    );
    expect(fallbackDue({ end_date: "", start_date: "2026-01-01" }, "2026-10-18")).toBe(
      "2026-01-01",
    );
    expect(fallbackDue({ end_date: "", start_date: "" }, "2026-10-18")).toBe("2026-10-18");
  });
  it("chỉ gửi mốc giữ lại; tiền chỉ cho mốc tiền; tên trống bỏ", () => {
    const rows = msRowsOf(detail());
    expect(rows.every((r) => r.keep)).toBe(true);
    const out = reviewMilestones(rows, { end_date: "2026-12-31", start_date: "" }, "2026-10-18");
    expect(out).toEqual([
      { kind: "delivery", title: "Giao", due_date: "2026-03-01" },
      { kind: "collect", due_date: "2026-12-31", amount: 500 },
      { kind: "other", title: "Khác", due_date: "2026-04-01" },
    ]);
    const r1 = rows.map((r, i) => (i === 0 ? { ...r, keep: false } : r));
    expect(reviewMilestones(r1, { end_date: "", start_date: "" }, "2026-10-18")).toHaveLength(2);
  });
});

describe("thân /review", () => {
  it("version, loại, chỉ ô đổi, dòng (id + SP + thành phần), mốc; hoa hồng chỉ khi Giới thiệu", () => {
    const d = detail();
    const form = { ...formOfConfirm(d), title: "Tên mới" };
    const line0 = form.items[0] as LineState;
    form.items = [
      { ...line0, product_id: P, component_id: U },
      { ...line0, id: "", name: "Mới", qty: "1", unit_price: "10" },
    ].map((l) => (l.id === "" ? { ...l, id: undefined as never } : l));
    const req = reviewRequest({
      c: d,
      f: form,
      n: readNumbers(form),
      productIds: [P, P],
      rows: msRowsOf(d).slice(0, 1),
      today: "2026-10-18",
    });
    expect(req).toEqual({
      version: 3,
      deal: "sell",
      fields: { title: "Tên mới" },
      items: [
        {
          id: U,
          name: "USB",
          unit: "cái",
          qty: 100,
          unit_price: 250_000,
          product_id: P,
          component_ids: [U],
        },
        { name: "Mới", unit: "cái", qty: 1, unit_price: 10, product_id: P },
      ],
      milestones: [{ kind: "delivery", title: "Giao", due_date: "2026-03-01" }],
    });
    const ref = { ...form, deal: "referral" as const, commission_pct: "8" };
    const r2 = reviewRequest({
      c: d,
      f: ref,
      n: readNumbers(ref),
      productIds: [P, P],
      rows: [],
      today: "2026-10-18",
    });
    expect([r2.commission_pct, r2.commission_fixed]).toEqual([8, null]);
  });
});
