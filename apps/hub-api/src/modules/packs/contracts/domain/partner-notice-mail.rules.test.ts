// CR-126 · thư báo kênh nền tảng: chủ đề nghiệp vụ, MỘT nút vào app, không link trả lời không đăng nhập, escape HTML.
import { describe, expect, it } from "bun:test";
import { buildPartnerNoticeMail } from "./partner-notice-mail.rules";

const base = {
  senderName: "Công ty A",
  title: "HĐ <b>mua</b> bán",
  message: null,
  round: 1,
  expiresAt: new Date("2026-11-20T03:00:00Z"),
  link: "https://app.test.vn/contracts/partner-inbox",
};

describe("buildPartnerNoticeMail", () => {
  it("chủ đề «<Công ty A> gửi hợp đồng <tên> cần anh/chị xác nhận», nút dẫn vào hộp thư đối tác, không kèm hợp đồng", () => {
    const m = buildPartnerNoticeMail(base);
    expect(m.subject).toBe("Công ty A gửi hợp đồng HĐ <b>mua</b> bán cần anh/chị xác nhận");
    expect(m.text).toContain(base.link);
    expect(m.text).toContain("20/11/2026");
    expect(m.html).toContain(`href="${base.link}"`);
    expect(m.html).not.toContain("<b>mua</b>");
    expect(m.html).not.toContain("partner-reply");
  });
  it("vòng 2 báo bản sửa; có lời nhắn thì hiện", () => {
    const m = buildPartnerNoticeMail({ ...base, round: 2, message: "Xin xem lại" });
    expect(m.text).toContain("bản sửa lần 2");
    expect(m.text).toContain("Lời nhắn: Xin xem lại");
  });
});
