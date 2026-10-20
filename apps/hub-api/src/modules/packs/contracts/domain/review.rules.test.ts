// V2-G · HD-02/HD-08 · §4.2 · C3: luật thuần của "Lưu" màn xác nhận (planReview) + phần AI đọc (aiReadOf / mergeExtraction).
import { describe, expect, it } from "bun:test";
import { aiReadOf, mergeExtraction, verifyExtraction } from "./extraction.rules";
import { fillFields } from "./fields.rules";
import { planReview, type ReviewCur } from "./review.rules";
import { norm, prepareSource } from "./verify.rules";

const cur = (o: Partial<ReviewCur> = {}): ReviewCur => ({
  status: "needs_review",
  deal: null,
  fields: {
    start_date: { value: "2026-03-01", quote: "", verified: true, edited: false },
    end_date: { value: "2026-12-31", quote: "", verified: true, edited: false },
  },
  approvalOn: true,
  commissionPct: null,
  commissionFixed: null,
  ...o,
});
const TODAY = "2026-10-20";

describe("V2-G · planReview", () => {
  it("không còn chờ xác nhận ⇒ not_reviewable", () => {
    for (const status of ["active", "extracting", "rejected", "extract_failed"])
      expect(planReview(cur({ status }), {}, TODAY)).toBe("not_reviewable");
  });

  it("loại chưa chọn ⇒ Bán; đổi loại ⇒ hướng theo loại; Giới thiệu ⇒ hướng sale", () => {
    const p = (deal?: "buy" | "sell" | "referral", c = cur()) =>
      planReview(c, deal ? { deal } : {}, TODAY);
    expect(p()).toMatchObject({ deal: "sell", direction: "sale" });
    expect(p("buy")).toMatchObject({ deal: "buy", direction: "purchase" });
    expect(p("referral")).toMatchObject({ deal: "referral", direction: "sale" });
    expect(p(undefined, cur({ deal: "buy" }))).toMatchObject({
      deal: "buy",
      direction: "purchase",
    });
  });

  it("hoa hồng chỉ cho Giới thiệu; không gửi ⇒ giữ đã lưu; gửi một bên ⇒ bỏ bên kia", () => {
    expect(planReview(cur(), { deal: "sell", commission_pct: 5 }, TODAY)).toBe("commission_kind");
    const ref = cur({ deal: "referral", commissionPct: 10 });
    expect(planReview(ref, {}, TODAY)).toMatchObject({ commissionPct: 10, commissionFixed: null });
    expect(planReview(ref, { commission_fixed: 250_000 }, TODAY)).toMatchObject({
      commissionPct: null,
      commissionFixed: 250_000,
    });
    // đổi Giới thiệu → Mua: hoa hồng cũ bị bỏ
    expect(planReview(ref, { deal: "buy" }, TODAY)).toMatchObject({
      commissionPct: null,
      commissionFixed: null,
    });
  });

  it("sửa trường: chỉ khoá đổi vào `changes`; trường sửa thành verified+edited", () => {
    const p = planReview(cur(), { fields: { title: "HĐ mới", end_date: "2026-12-31" } }, TODAY);
    if (typeof p === "string") throw new Error(p);
    expect(p.changes.map((c) => c.key)).toEqual(["title"]);
    expect(p.fields.title).toMatchObject({ value: "HĐ mới", verified: true, edited: true });
  });

  it("mốc: tenant bật duyệt + không gửi ⇒ không đụng (null); gửi mảng rỗng ⇒ xoá mốc AI (mảng rỗng)", () => {
    const keep = planReview(cur(), {}, TODAY);
    expect(typeof keep !== "string" && keep.milestones).toBeNull();
    const clear = planReview(cur(), { milestones: [] }, TODAY);
    expect(typeof clear !== "string" && clear.milestones).toEqual([]);
    expect(typeof clear !== "string" && clear.activate).toBe(false);
  });

  it("mốc người gửi: loại BA ⇒ (kind, direction), việc của ai theo loại, tên mặc định, nguồn ai", () => {
    const p = planReview(
      cur(),
      {
        deal: "buy",
        milestones: [
          { kind: "delivery", due_date: "2026-04-01" },
          { kind: "pay", title: "  Trả đợt 1 ", due_date: "2026-05-01", amount: 5_000_000 },
        ],
      },
      TODAY,
    );
    if (typeof p === "string") throw new Error(p);
    expect(p.milestones).toEqual([
      {
        kind: "delivery",
        direction: "pay",
        title: "Giao hàng",
        owner: "partner",
        due_date: "2026-04-01",
        qty: null,
        amount: null,
        source: "ai",
      },
      {
        kind: "payment",
        direction: "pay",
        title: "Trả đợt 1",
        owner: "ours",
        due_date: "2026-05-01",
        qty: null,
        amount: 5_000_000,
        source: "ai",
      },
    ]);
  });

  it("số tiền cho mốc không phải tiền ⇒ milestone_invalid", () => {
    expect(
      planReview(
        cur(),
        { milestones: [{ kind: "delivery", due_date: "2026-04-01", amount: 1 }] },
        TODAY,
      ),
    ).toBe("milestone_invalid");
  });

  it("tenant tắt duyệt: activate; không có mốc ⇒ mốc mặc định theo loại + ngày HĐ; có mốc người gửi thì dùng", () => {
    const off = cur({ approvalOn: false });
    const d = planReview(off, { deal: "sell" }, TODAY);
    if (typeof d === "string") throw new Error(d);
    expect(d.activate).toBe(true);
    expect(d.milestones?.map((m) => [m.kind, m.direction, m.due_date, m.source])).toEqual([
      ["delivery", "receive", "2026-03-01", "default"],
      ["payment", "receive", "2026-12-31", "default"],
    ]);
    const empty = planReview(off, { deal: "referral", milestones: [] }, TODAY);
    expect(typeof empty !== "string" && empty.milestones?.map((m) => m.kind)).toEqual([
      "commission",
    ]);
    const own = planReview(
      off,
      { milestones: [{ kind: "collect", due_date: "2026-06-01", amount: 7 }] },
      TODAY,
    );
    expect(typeof own !== "string" && own.milestones?.map((m) => m.source)).toEqual(["ai"]);
  });
});

const TEXT = "Bên bán: Công ty A. Thanh toán trong 30 ngày. Phạt chậm giao 0,5% mỗi ngày.";
const empty = () =>
  Object.fromEntries(
    Object.keys(fillFields({})).map((k) => [k, { value: null, quote: "" }]),
  ) as never;
const raw = (o: Record<string, unknown> = {}) =>
  ({ fields: { ...(empty() as object) }, items: [], clauses: [], ...o }) as never;

describe("V2-G · aiReadOf (phần AI đọc)", () => {
  const src = prepareSource(TEXT);
  const fields = (over: Record<string, unknown> = {}) =>
    fillFields({
      supplier_name: { value: "Công ty A", quote: "Bên bán: Công ty A", verified: true },
      payment_terms: { value: "30 ngày", quote: "Thanh toán trong 30 ngày", verified: true },
      penalty: { value: "0,5%/ngày", quote: "không có trong văn bản", verified: false },
      ...over,
    });

  it("bản trích cũ (không khoá v2) ⇒ null", () => {
    expect(aiReadOf(raw(), fields() as never, src)).toBeNull();
  });

  it("chưa chắc = AI tự báo ∪ có giá trị mà trích dẫn không có trong văn bản; theo thứ tự khoá", () => {
    const r = aiReadOf(
      raw({ deal: "referral", unsure: ["payment_terms"] }),
      fields() as never,
      src,
    );
    expect(r?.unsure).toEqual(["payment_terms", "penalty"]);
  });

  it("Mua/Bán luôn chưa chắc (AI không biết bên nào là của mình); Giới thiệu thì tin, trừ khi AI tự báo", () => {
    expect(aiReadOf(raw({ deal: "buy" }), fields() as never, src)?.unsure).toContain("deal");
    expect(aiReadOf(raw({ deal: "sell" }), fields() as never, src)?.unsure).toContain("deal");
    expect(aiReadOf(raw({ deal: "referral" }), fields() as never, src)?.unsure).not.toContain(
      "deal",
    );
    expect(
      aiReadOf(raw({ deal: "referral", unsure: ["deal"] }), fields() as never, src)?.unsure,
    ).toContain("deal");
    expect(
      aiReadOf(raw({ deal: null, summary: null }), fields() as never, src)?.unsure,
    ).not.toContain("deal");
  });

  it("mốc: verified khi trích dẫn có trong văn bản (chịu dấu/hoa thường), rỗng ⇒ false", () => {
    const r = aiReadOf(
      raw({
        milestones: [
          {
            kind: "pay",
            title: null,
            due_date: "2026-05-01",
            amount: 1,
            quote: "THANH TOÁN TRONG 30 NGÀY",
          },
          {
            kind: "other",
            title: "Phạt",
            due_date: null,
            amount: null,
            quote: "câu không có thật",
          },
          { kind: "delivery", title: null, due_date: null, amount: null, quote: "" },
        ],
      }),
      fields() as never,
      src,
    );
    expect(r?.milestones.map((m) => m.verified)).toEqual([true, false, false]);
    expect(norm("Thanh toán")).toBe("thanh toan");
  });

  it("verifyExtraction + mergeExtraction: trường người đã sửa không còn chưa chắc; deal vẫn do AI nói", () => {
    const v = verifyExtraction({
      raw: raw({
        fields: {
          ...(empty() as object),
          supplier_name: { value: "Công ty A", quote: "Bên bán: Công ty A" },
          penalty: { value: "0,5%", quote: "bịa" },
        },
        deal: "buy",
      }),
      source: TEXT,
      kind: "contract",
    });
    expect(v.ai?.unsure).toEqual(["penalty", "deal"]);
    const old = { penalty: { value: "1%", quote: "", verified: true, edited: true } };
    const m = mergeExtraction(v, old, false);
    expect(m.ai?.unsure).toEqual(["deal"]);
    expect(m.fields.penalty.value).toBe("1%");
  });
});
