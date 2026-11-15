// CR-171 · lỗi «điền hết vẫn báo thiếu» (Nhượng quyền) + «dòng hàng chưa gắn SP chặn hộp Gắn sản phẩm»: luật thuần phía web.
import { describe, expect, it } from "bun:test";
import { blockerMessage } from "./blocker";
import { EMPTY_FORM, EMPTY_LINE, type FormState } from "./form-model";
import { termsMissing, termsToPut } from "./kind-terms";

const t = ((k: string, o?: { list?: string }) => (o?.list ? `${k}:${o.list}` : k)) as never;

const FRANCHISE_OK = {
  role: "franchisor",
  brand: "Evolu",
  fee_basis: "revenue_pct",
  fee_pct: "5",
  period: "month",
};
const base = (o: Partial<FormState>): FormState => ({
  ...EMPTY_FORM,
  title: "HĐ",
  partner_name: "Đối tác",
  start_date: "2026-01-01",
  ...o,
});

describe("CR-171 · trường riêng đủ theo MỘT luật (khớp máy chủ)", () => {
  it("phí % đủ (không cần số cố định) ⇒ không thiếu; phí cố định đủ (không cần %) ⇒ không thiếu", () => {
    expect(termsMissing("franchise", FRANCHISE_OK)).toEqual([]);
    const fixed = { ...FRANCHISE_OK, fee_basis: "fixed", fee_pct: "", fee_fixed: "2.000.000" };
    expect(termsMissing("franchise", fixed)).toEqual([]);
  });
  it("chọn cách tính phí mà chưa nhập mức ⇒ chỉ đúng ô mức đó", () => {
    expect(termsMissing("franchise", { ...FRANCHISE_OK, fee_pct: "" })).toEqual(["fee_pct"]);
    expect(
      termsMissing("franchise", { ...FRANCHISE_OK, fee_basis: "fixed", fee_pct: "5" }),
    ).toEqual(["fee_fixed"]);
  });
  it("bên nhượng ở nước ngoài + ô «Đã đăng ký BCT» để trống (không tick = chưa đăng ký) ⇒ không bị đòi", () => {
    const t1 = { ...FRANCHISE_OK, foreign_franchisor: "1" };
    expect(termsMissing("franchise", t1)).toEqual([]);
    expect(termsToPut("franchise", t1).body.moit_registered).toBe(false);
  });
  it("Hợp tác: chia % cần phần của mình + kỳ; «không chia» thì không", () => {
    expect(termsMissing("cooperation", { scope: "x", split_basis: "profit" })).toEqual([
      "our_share_pct",
      "settle_period",
    ]);
    expect(termsMissing("cooperation", { scope: "x", split_basis: "none" })).toEqual([]);
  });
});

describe("CR-171 · blockerMessage", () => {
  it("Nhượng quyền thiếu ô ⇒ câu báo nêu đúng tên ô thiếu", () => {
    const msg = blockerMessage(
      base({ deal: "franchise", terms: { role: "franchisor" } }),
      t,
      () => {},
    );
    expect(msg).toContain("contracts.kinds.f.brand");
    expect(msg).toContain("contracts.kinds.f.fee_basis");
    expect(msg).toContain("contracts.kinds.f.period");
    expect(msg).not.toContain("contracts.kinds.f.role");
  });
  it("Nhượng quyền đủ ô ⇒ không chặn", () => {
    expect(
      blockerMessage(base({ deal: "franchise", terms: FRANCHISE_OK }), t, () => {}),
    ).toBeNull();
  });
  it("bước xác nhận: dòng chưa gắn SP KHÔNG chặn lưu nháp (hộp «Gắn sản phẩm» xử lý sau)", () => {
    const f = base({ deal: "sell", items: [{ ...EMPTY_LINE, name: "nuoc suoi" }] });
    expect(blockerMessage(f, t, () => {})).toContain("contracts.cform.lineUnlinked");
    expect(blockerMessage(f, t, () => {}, undefined, undefined, { lines: false })).toBeNull();
  });
});
