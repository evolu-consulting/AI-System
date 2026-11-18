// CR-182 · luật thuần «Đối tác ký qua link» (BR-C5).
import { describe, expect, it } from "bun:test";
import {
  canResendLink,
  firstEmailContact,
  hashLinkToken,
  inviteMail,
  linkAccess,
  linkExpiry,
  linkState,
  needsPartnerStep,
  newLinkToken,
  partnerLabel,
  partnerMarksIssue,
  partnerOpenFields,
  signLinkUrl,
  signStepDone,
} from "./partner-sign.rules";

const now = new Date("2026-11-18T03:00:00Z");
const part = { page: 0, x: 1, y: 1, w: 2, h: 2, cx: 1, cy: 1, cw: 2, ch: 2 };
const fields = [
  { id: "fa", side: "A", file_id: "f1", signed_version_id: null },
  { id: "fb", side: "B", file_id: "f1", signed_version_id: null },
  { id: "fb2", side: "B", file_id: "f2", signed_version_id: null },
  { id: "fbs", side: "B", file_id: "f1", signed_version_id: "v" },
];

describe("token + link", () => {
  it("token 43 ký tự base64url, băm hex 64, khác nhau mỗi lần", async () => {
    const t = newLinkToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newLinkToken()).not.toBe(t);
    expect(await hashLinkToken(t)).toMatch(/^[0-9a-f]{64}$/);
  });
  it("link = <APP_URL>/ky/<token>, bỏ dấu / thừa", () => {
    expect(signLinkUrl("https://app.vn///", "abc")).toBe("https://app.vn/ky/abc");
  });
  it("hạn = hạn của bước nếu còn ở tương lai, ngược lại mặc định 7 ngày", () => {
    const due = new Date("2026-11-20T00:00:00Z");
    expect(linkExpiry(due, now).toISOString()).toBe(due.toISOString());
    expect(linkExpiry(null, now).toISOString()).toBe("2026-11-25T03:00:00.000Z");
    expect(linkExpiry("2026-11-01T00:00:00Z", now).toISOString()).toBe("2026-11-25T03:00:00.000Z");
  });
  it("trạng thái: thu hồi > đã ký > từ chối > hết hạn > mở, ký/từ chối ⇒ chỉ xem (closed), hết hạn/thu hồi ⇒ gone", () => {
    const base = {
      signed_at: null,
      declined_at: null,
      revoked_at: null,
      expires_at: "2026-11-19T00:00:00Z",
    };
    expect(linkState(base, now)).toBe("open");
    expect(linkState({ ...base, expires_at: "2026-11-18T00:00:00Z" }, now)).toBe("expired");
    expect(linkState({ ...base, declined_at: "x" }, now)).toBe("declined");
    expect(linkState({ ...base, signed_at: "x", declined_at: null }, now)).toBe("signed");
    expect(linkState({ ...base, signed_at: "x", revoked_at: "y" }, now)).toBe("revoked");
    expect(linkAccess("open")).toBe("ok");
    expect(linkAccess("signed")).toBe("closed");
    expect(linkAccess("declined")).toBe("closed");
    expect(linkAccess("expired")).toBe("gone");
    expect(linkAccess("revoked")).toBe("gone");
  });
});

describe("quyền + liên hệ", () => {
  it("gửi lại: người tải lên hoặc quản trị, người khác không", () => {
    expect(canResendLink({ userId: "u1", uploaderId: "u1", isAdmin: false })).toBe(true);
    expect(canResendLink({ userId: "u2", uploaderId: "u1", isAdmin: true })).toBe(true);
    expect(canResendLink({ userId: "u2", uploaderId: "u1", isAdmin: false })).toBe(false);
    expect(canResendLink({ userId: "u2", uploaderId: null, isAdmin: false })).toBe(false);
  });
  it("liên hệ đầu tiên CÓ email", () => {
    expect(
      firstEmailContact([{ email: null }, { email: " " }, { email: "a@x.vn" }, { email: "b@x.vn" }])
        ?.email,
    ).toBe("a@x.vn");
    expect(firstEmailContact([{ email: null }])).toBeNull();
  });
  it("nhãn người ký «Đối tác: <tên liên hệ>», thiếu tên ⇒ tên đối tác", () => {
    expect(partnerLabel("Chị Lan", "Cty B")).toBe("Đối tác: Chị Lan");
    expect(partnerLabel(" ", "Cty B")).toBe("Đối tác: Cty B");
  });
});

describe("dấu của đối tác", () => {
  it("ô Bên A / ô tệp khác / ô đã ký ⇒ forbidden, ô Bên B chưa ký của đúng tệp + tự đặt thêm ⇒ ok", () => {
    const m = (field_id?: string, placement = "field") => ({
      placement,
      parts: [part],
      ...(field_id ? { field_id } : {}),
    });
    expect(partnerMarksIssue([m("fa")], fields, "f1")).toBe("forbidden");
    expect(partnerMarksIssue([m("fb2")], fields, "f1")).toBe("forbidden");
    expect(partnerMarksIssue([m("fbs")], fields, "f1")).toBe("forbidden");
    expect(partnerMarksIssue([m("none")], fields, "f1")).toBe("forbidden");
    expect(
      partnerMarksIssue([m("fb"), m(undefined, "free"), m(undefined, "seam")], fields, "f1"),
    ).toBeNull();
  });
  it("lệch kiểu (field không có field_id, free có field_id) hoặc trùng ô ⇒ invalid", () => {
    expect(partnerMarksIssue([{ placement: "field", parts: [part] }], fields, "f1")).toBe(
      "invalid",
    );
    expect(
      partnerMarksIssue([{ placement: "free", field_id: "fb", parts: [part] }], fields, "f1"),
    ).toBe("invalid");
    const f = { placement: "field", field_id: "fb", parts: [part] };
    expect(partnerMarksIssue([f, f], fields, "f1")).toBe("invalid");
  });
  it("đếm ô Bên B còn lại, bước đối tác khi Bên A đủ + còn ô Bên B, bước Ký xong khi cả hai đủ", () => {
    expect(partnerOpenFields(fields)).toBe(2);
    expect(needsPartnerStep(true, 3, 2)).toBe(true);
    expect(needsPartnerStep(false, 3, 2)).toBe(false);
    expect(needsPartnerStep(true, 0, 0)).toBe(false);
    expect(signStepDone({ total: 2, open: 0 }, { total: 1, open: 1 })).toBe(false);
    expect(signStepDone({ total: 2, open: 0 }, { total: 1, open: 0 })).toBe(true);
    expect(signStepDone({ total: 2, open: 1 }, { total: 0, open: 0 })).toBe(false);
  });
});

describe("thư mời ký", () => {
  it("ghi tên công ty A, tên HĐ, số tệp, số chỗ ký, hạn (giờ VN) và link, chặn xuống dòng trong tiêu đề", () => {
    const m = inviteMail({
      companyName: "Cty A\nBcc: x",
      contractTitle: "HĐ 1",
      files: 2,
      fields: 3,
      expiresAt: new Date("2026-11-25T20:00:00Z"),
      link: "https://app.vn/ky/tok",
    });
    expect(m.subject).not.toContain("\n");
    expect(m.text).toContain("2 tệp cần ký, 3 chỗ ký");
    expect(m.text).toContain("Hạn ký: 26/11/2026");
    expect(m.text).toContain("https://app.vn/ky/tok");
    expect(m.html).toContain("https://app.vn/ky/tok");
  });
});
