// CR-185 · điều kiện đối tác ⇒ cảnh báo theo quy trình (gửi) / đầu mục (nhận).
import { describe, expect, test } from "bun:test";
import { type PartnerChecklist, type PartnerItem, partnerChecklist } from "@ai/contracts/modules";
import { hasPartnerSend, receiveWarn, sendWarn } from "./partner-warn";

const admin = {
  contracts_app: true,
  feature: true,
  legal_name: true,
  tax_code: true,
  listed: true,
};
const hub = { channel: true, receive_flow: true, send_flow: true, groups: [] };
const flow = (partner: boolean) => ({
  partnerSend: partner,
  graph: [{ kind: partner ? "partner_send" : "review" }] as never,
});
const gaps = (c: PartnerChecklist) => c.items.filter((i: PartnerItem) => i.state !== "ok");

describe("sendWarn", () => {
  test("đủ điều kiện ⇒ không cảnh báo", () => {
    expect(sendWarn(partnerChecklist(admin, hub), flow(true))).toBeNull();
  });
  test("thiếu MST ⇒ cảnh báo trên quy trình có bước Gửi đối tác, ghi điều thiếu + ai sửa", () => {
    const c = partnerChecklist({ ...admin, tax_code: false }, hub);
    expect(sendWarn(c, flow(true))).toEqual({ what: ["profile"], who: ["platform"] });
  });
  test("quy trình KHÔNG có bước Gửi đối tác ⇒ không cảnh báo dù thiếu", () => {
    const c = partnerChecklist({ ...admin, tax_code: false }, hub);
    expect(hasPartnerSend(flow(false))).toBe(false);
    expect(sendWarn(c, flow(false))).toBeNull();
  });
  test("thiếu điều kiện chỉ của phía NHẬN (đăng ký đối tác) ⇒ quy trình gửi không bị cảnh báo", () => {
    const c = partnerChecklist({ ...admin, listed: false }, hub);
    expect(gaps(c).map((i) => i.key)).toEqual(["listed"]);
    expect(sendWarn(c, flow(true))).toBeNull();
  });
  test("không có dữ liệu (thành viên không phải quản trị) ⇒ không cảnh báo", () => {
    expect(sendWarn(null, flow(true))).toBeNull();
    expect(receiveWarn(null)).toBe(false);
  });
});

describe("receiveWarn", () => {
  test("tính năng bật mà chưa có quy trình Nhận HĐ ⇒ cảnh báo đầu mục", () => {
    expect(receiveWarn(partnerChecklist(admin, { ...hub, receive_flow: false }))).toBe(true);
  });
  test("đã có quy trình Nhận HĐ ⇒ không", () => {
    expect(receiveWarn(partnerChecklist(admin, hub))).toBe(false);
  });
  test("tính năng tắt (công ty không dùng đối tác) ⇒ không nhắc", () => {
    expect(
      receiveWarn(partnerChecklist({ ...admin, feature: false }, { ...hub, receive_flow: false })),
    ).toBe(false);
  });
});
