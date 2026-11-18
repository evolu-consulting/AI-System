// CR-182 · trạng thái link ký của đối tác ở trang HĐ: dòng thông tin, ai thấy «Gửi lại link».
import { describe, expect, test } from "bun:test";
import type { PartnerLinkStatusOut } from "@ai/contracts/pack-contracts";
import { canShowResend, linkLines } from "./partner-link-view";

const link = (o: Partial<PartnerLinkStatusOut> = {}): PartnerLinkStatusOut => ({
  state: "open",
  sent_at: "2026-11-17T01:00:00.000Z",
  opened_at: null,
  expires_at: "2026-11-24T01:00:00.000Z",
  signed_at: null,
  declined_at: null,
  decline_reason: null,
  contact_name: "Trần Thị B",
  ...o,
});

describe("link ký của đối tác ở trang HĐ", () => {
  test("đang chờ: đã gửi lúc, chưa mở, hạn", () => {
    const l = linkLines(link(), "vi");
    expect(l.map((x) => x.key)).toEqual(["sentAt", "openedAt", "due"]);
    expect(l[0]?.value).toBe("17/11/2026 08:00");
    expect(l[1]?.value).toBeNull();
  });
  test("đã mở: có giờ mở, không còn chờ ⇒ không hiện hạn", () => {
    const l = linkLines(link({ state: "declined", opened_at: "2026-11-17T02:00:00.000Z" }), "vi");
    expect(l.map((x) => x.key)).toEqual(["sentAt", "openedAt"]);
    expect(l[1]?.value).toBe("17/11/2026 09:00");
  });
  test("gửi lại: mọi trạng thái trừ «đã ký», chưa gửi link ⇒ không có nút", () => {
    expect(canShowResend(link())).toBe(true);
    expect(canShowResend(link({ state: "declined" }))).toBe(true);
    expect(canShowResend(link({ state: "expired" }))).toBe(true);
    expect(canShowResend(link({ state: "revoked" }))).toBe(true);
    expect(canShowResend(link({ state: "signed" }))).toBe(false);
    expect(canShowResend(null)).toBe(false);
  });
});
