// CR-127 · P2 · BR-60 · luật thuần «Đề nghị ký cùng lúc»: không bật ⇒ null; bật thiếu lý do ⇒ lỗi nghiệp vụ; hạn mặc định 2 giờ / 4 giờ; vào payload.
import { describe, expect, it } from "bun:test";
import { buildPayload, signTogetherPlan } from "./partner-send.rules";

describe("signTogetherPlan (BR-60)", () => {
  it("không bật ⇒ null (gửi thường), kể cả có lý do", () => {
    expect(signTogetherPlan({})).toBeNull();
    expect(signTogetherPlan({ sign_together: false, sign_reason: "gấp" })).toBeNull();
  });
  it("bật thiếu/rỗng lý do ⇒ SIGN_TOGETHER_REASON_REQUIRED", () => {
    expect(() => signTogetherPlan({ sign_together: true })).toThrow(
      "SIGN_TOGETHER_REASON_REQUIRED",
    );
    expect(() => signTogetherPlan({ sign_together: true, sign_reason: "  " })).toThrow(
      "SIGN_TOGETHER_REASON_REQUIRED",
    );
  });
  it("hạn mặc định 2 giờ trả lời, 4 giờ ký; hạn đặt riêng giữ nguyên", () => {
    expect(signTogetherPlan({ sign_together: true, sign_reason: " gấp " })).toEqual({
      reason: "gấp",
      acceptH: 2,
      signH: 4,
    });
    expect(
      signTogetherPlan({ sign_together: true, sign_reason: "x", accept_h: 6, sign_h: 24 }),
    ).toMatchObject({ acceptH: 6, signH: 24 });
  });
  it("payload mang sign_together {reason, accept_h, sign_h}; không đề nghị ⇒ không có khoá", () => {
    const base = { title: "HĐ", message: undefined, hint: undefined, sendFields: [], fields: {} };
    const p = buildPayload({ ...base, signTogether: { reason: "gấp", acceptH: 2, signH: 4 } });
    expect(p.sign_together).toEqual({ reason: "gấp", accept_h: 2, sign_h: 4 });
    expect("sign_together" in buildPayload(base)).toBe(false);
  });
});
