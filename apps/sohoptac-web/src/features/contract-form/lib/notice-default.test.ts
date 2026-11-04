// V2-H · BA 5.8: "Nhắc trước khi hết hạn" điền sẵn từ Cài đặt chỉ khi ô còn trống.
import { describe, expect, it } from "bun:test";
import { EMPTY_FORM, withNoticeDefault } from "./form-model";

describe("V2-H · withNoticeDefault", () => {
  it("ô trống ⇒ số Cài đặt; đã có số (người gõ / HĐ ghi) ⇒ giữ; chưa tải ⇒ giữ nguyên", () => {
    const blank = { ...EMPTY_FORM, notice_days: " " };
    expect(withNoticeDefault(blank, 45).notice_days).toBe("45");
    expect(withNoticeDefault({ ...EMPTY_FORM, notice_days: "15" }, 45).notice_days).toBe("15");
    expect(withNoticeDefault(blank, undefined)).toBe(blank);
  });
});
