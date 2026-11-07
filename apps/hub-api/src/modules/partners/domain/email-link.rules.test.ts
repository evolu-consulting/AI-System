// CR-124 · q5 · FLOW4-FR-12/13 · luật thuần của đường email: token, IP rút gọn, form trả lời, mẫu thư.
import { describe, expect, it } from "bun:test";
import { sameSiteRequest } from "../adapters/partner-public.routes";
import {
  buildPartnerEmail,
  clientIp,
  hashHex,
  ipPrefix,
  linkOf,
  newToken,
  parseReplyForm,
  sharedRows,
  TOKEN_RE,
} from "./email-link.rules";

describe("CR-124 q5 · token", () => {
  it("256-bit, base64url 43 ký tự, không trùng; băm 64 hex khác token", async () => {
    const a = newToken();
    expect(TOKEN_RE.test(a)).toBe(true);
    expect(newToken()).not.toBe(a);
    const h = await hashHex(a);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain(a);
    expect(await hashHex(a)).toBe(h);
  });
  it("link dựng từ gốc URL + token", () => {
    const t = newToken();
    const link = linkOf("https://app.x.vn/", t);
    expect(link).toBe(`https://app.x.vn/partner-reply/${t}`);
  });
});

describe("CR-124 q5 · IP + CSRF", () => {
  it("IP rút gọn /24 và lấy IP cuối XFF (đầu do client tự khai)", () => {
    expect(ipPrefix("203.0.113.77")).toBe("203.0.113.0/24");
    expect(ipPrefix("2001:db8:85a3:8d3::1")).toBe("2001:db8:85a3::/48");
    expect(ipPrefix(null)).toBeNull();
    const h = new Headers({ "x-forwarded-for": "1.1.1.1, 198.51.100.9" });
    expect(clientIp(h)).toBe("198.51.100.9");
  });
  it("cùng nguồn: Sec-Fetch-Site / Origin so Host", () => {
    expect(sameSiteRequest(new Headers({ "sec-fetch-site": "same-origin" }))).toBe(true);
    expect(sameSiteRequest(new Headers({ "sec-fetch-site": "cross-site" }))).toBe(false);
    expect(sameSiteRequest(new Headers({ origin: "https://evil.example", host: "app.x.vn" }))).toBe(
      false,
    );
    expect(
      sameSiteRequest(new Headers({ origin: "https://app.x.vn:8083", host: "app.x.vn" })),
    ).toBe(true);
  });
});

describe("CR-124 q5 · form trả lời", () => {
  const ok = { name: "Nguyễn Văn B", title: "Giám đốc", reason: "" };
  it("Xác nhận không cần lý do", () => {
    const r = parseReplyForm({ ...ok, action: "confirm" });
    expect(r.ok && r.form.outcome).toBe("confirmed");
  });
  it("Trả lại / Từ chối bắt buộc lý do; thiếu tên/chức vụ bị chặn", () => {
    expect(parseReplyForm({ ...ok, action: "return" })).toEqual({ ok: false, problem: "reason" });
    expect(parseReplyForm({ ...ok, action: "decline", reason: "sai đơn giá" }).ok).toBe(true);
    expect(parseReplyForm({ ...ok, name: " ", action: "confirm" })).toEqual({
      ok: false,
      problem: "name",
    });
    expect(parseReplyForm({ ...ok, title: "", action: "confirm" })).toEqual({
      ok: false,
      problem: "title",
    });
    expect(parseReplyForm({ ...ok, action: "hack" })).toEqual({ ok: false, problem: "outcome" });
  });
});

describe("CR-124 q5 · mẫu thư", () => {
  const base = {
    mailboxId: "m1",
    attempts: 1,
    tenantId: "t1",
    to: "b@x.vn",
    link: "https://app.x.vn/partner-reply/abc",
    title: 'HĐ "<b>x</b>"',
    senderName: "Công ty A",
    senderVerified: true,
    round: 2,
    message: "Xin xác nhận",
    prevReason: "sai đơn giá",
    expiresAt: new Date("2026-11-14T05:00:00Z"),
  };
  it("tiếng Việt nghiệp vụ, có link, lý do lần trước, HTML thoát ký tự", () => {
    const m = buildPartnerEmail(base);
    expect(m.text).toContain("Hạn trả lời: 14/11/2026");
    expect(m.text).toContain("bản sửa lần 2");
    expect(m.text).toContain("sai đơn giá");
    expect(m.text).toContain(base.link);
    expect(m.text).toContain("không phải chữ ký số");
    expect(m.html).not.toContain("<b>x</b>");
    expect(m.html).toContain("&#60;b&#62;");
    expect(m.idempotencyKey).toBe("partner-email-m1-1");
    expect(m.subject).not.toMatch(/[\r\n]/);
  });
  it("trường chia sẻ: chỉ bốn khoá cho phép, giá trị tiền định dạng", () => {
    const rows = sharedRows({ total_value: 600000000, secret: "x", end_date: "2027-01-01" });
    expect(rows.map((r) => r.label)).toEqual(["Giá trị hợp đồng", "Ngày hết hạn"]);
    expect(rows[0]?.value).toContain("600");
  });
});
