// CR-127 · U6 · M2d: phiên ký cùng lúc — ai thấy nút gì, hai dòng ký, lý do khi kết thúc. Thuần.
import { describe, expect, test } from "bun:test";
import { endedReason, type SignSession, sessionView } from "./sign-session-view";

const s = (o: Partial<SignSession>): SignSession => ({
  side: "to",
  status: "proposed",
  expire_choice: null,
  reason: "Hàng xuất cảng trước 17:00",
  accept_deadline_at: "2026-11-10T09:00:00Z",
  sign_deadline_at: null,
  from_company: "Tân Phát",
  from_signer_name: "Nguyễn Văn An",
  from_signed_at: null,
  to_company: "Minh Long",
  to_signer_name: null,
  to_signed_at: null,
  cancel_side: null,
  cancel_reason: null,
  ...o,
});

describe("sessionView", () => {
  test("bên nhận chưa trả lời ⇒ được Đồng ý/Bình thường/Từ chối; chưa có hai dòng ký; hạn = hạn trả lời", () => {
    const v = sessionView(s({}), true);
    expect(v.canRespond).toBe(true);
    expect(v.canCancel).toBe(false);
    expect(v.rows).toBeNull();
    expect(v.deadline).toBe("2026-11-10T09:00:00Z");
  });
  test("người chỉ xem không có nút; bên gửi chưa được trả lời được huỷ, không trả lời được", () => {
    expect(sessionView(s({}), false).canRespond).toBe(false);
    const from = sessionView(s({ side: "from" }), true);
    expect(from.canRespond).toBe(false);
    expect(from.canCancel).toBe(true);
  });
  test("đang ký chung ⇒ hai dòng ký (công ty + người ký) và Huỷ phiên ký; hạn = hạn ký", () => {
    const v = sessionView(
      s({
        status: "signing",
        sign_deadline_at: "2026-11-10T13:00:00Z",
        from_signed_at: "2026-11-10T07:05:00Z",
        to_signer_name: "Đỗ Thị Lan",
      }),
      true,
    );
    expect(v.canCancel).toBe(true);
    expect(v.rows?.map((r) => [r.company, r.signer, !!r.signedAt])).toEqual([
      ["Tân Phát", "Nguyễn Văn An", true],
      ["Minh Long", "Đỗ Thị Lan", false],
    ]);
    expect(v.deadline).toBe("2026-11-10T13:00:00Z");
  });
  test("kết thúc ⇒ không nút; huỷ/từ chối nêu lý do", () => {
    expect(sessionView(s({ status: "done" }), true).canCancel).toBe(false);
    expect(endedReason(s({ status: "cancelled", cancel_reason: "Cần sửa điều 4" }))).toBe(
      "Cần sửa điều 4",
    );
    expect(endedReason(s({ status: "expired" }))).toBeNull();
  });
});
