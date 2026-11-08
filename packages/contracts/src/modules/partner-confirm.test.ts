// CR-125 · UX-S7 (H7) · luật thuần danh sách điều kiện Đối tác xác nhận hợp đồng.
import { describe, expect, it } from "bun:test";
import { type PartnerAdminPart, type PartnerHubPart, partnerChecklist } from "./partner-confirm";

const admin: PartnerAdminPart = {
  contracts_app: true,
  feature: true,
  legal_name: true,
  tax_code: true,
  listed: true,
};
const hub: PartnerHubPart = {
  channel: true,
  receive_template_id: "tpl-1",
  receive_flow: true,
  send_flow: true,
  groups: [{ key: "phong-kinh-doanh", exists: true, members: 2 }],
};
const state = (c: ReturnType<typeof partnerChecklist>, k: string) =>
  c.items.find((i) => i.key === k);

describe("partnerChecklist", () => {
  it("đủ mọi điều kiện ⇒ sẵn sàng gửi và nhận, mọi dòng Xong", () => {
    const c = partnerChecklist(admin, hub);
    expect(c.on).toBe(true);
    expect(c.ready_to_send).toBe(true);
    expect(c.ready_to_receive).toBe(true);
    expect(c.items.every((i) => i.state === "ok")).toBe(true);
  });

  it("chưa cấp tính năng ⇒ tắt, nêu nút bật và AI làm (nền tảng)", () => {
    const c = partnerChecklist({ ...admin, feature: false }, hub);
    expect(c.on).toBe(false);
    expect(c.ready_to_receive).toBe(false);
    expect(state(c, "feature")).toMatchObject({
      state: "todo",
      who: "platform",
      fix: "grant-feature",
    });
  });

  it("thiếu hồ sơ ⇒ nền tảng điền (Mở Hồ sơ); chưa cho tìm thấy ⇒ công ty làm, không có nút", () => {
    const c = partnerChecklist({ ...admin, tax_code: false, listed: false }, hub);
    expect(state(c, "profile")).toMatchObject({
      state: "todo",
      who: "platform",
      fix: "open-profile",
    });
    expect(state(c, "listed")).toMatchObject({ state: "todo", who: "company" });
    expect(state(c, "listed")?.fix).toBeUndefined();
    expect(c.ready_to_receive).toBe(false);
    expect(c.ready_to_send).toBe(false); // hồ sơ cần cho cả hai hướng
  });

  it("chưa có flow nhận ⇒ nút Gán kèm id mẫu; chỉ chặn hướng nhận", () => {
    const c = partnerChecklist(admin, { ...hub, receive_flow: false });
    expect(state(c, "receive_flow")).toMatchObject({
      fix: "assign-receive-flow",
      params: { template: "tpl-1" },
    });
    expect(c.ready_to_receive).toBe(false);
    expect(c.ready_to_send).toBe(true);
  });

  it("chưa có flow gửi ⇒ công ty làm (Mở Quy trình); chỉ chặn hướng gửi", () => {
    const c = partnerChecklist(admin, { ...hub, send_flow: false });
    expect(state(c, "send_flow")).toMatchObject({ who: "company", fix: "open-flows" });
    expect(c.ready_to_send).toBe(false);
    expect(c.ready_to_receive).toBe(true);
  });

  it("nhóm: thiếu nhóm ⇒ nền tảng tạo; có nhóm nhưng trống ⇒ công ty thêm người (không nút tạo)", () => {
    const missing = partnerChecklist(admin, {
      ...hub,
      groups: [{ key: "phong-kinh-doanh", exists: false, members: 0 }],
    });
    expect(state(missing, "groups")).toMatchObject({
      state: "todo",
      who: "platform",
      fix: "create-group",
      params: { groups: ["phong-kinh-doanh"] },
    });
    const empty = partnerChecklist(admin, {
      ...hub,
      groups: [{ key: "phong-kinh-doanh", exists: true, members: 0 }],
    });
    expect(state(empty, "groups")).toMatchObject({ state: "todo", who: "company" });
    expect(state(empty, "groups")?.fix).toBeUndefined();
  });

  it("Hub không trả lời ⇒ mục của Hub 'chưa rõ', chưa coi là sẵn sàng", () => {
    const c = partnerChecklist(admin, null);
    for (const k of ["channel", "receive_flow", "groups", "send_flow"])
      expect(state(c, k)?.state).toBe("unknown");
    expect(c.ready_to_receive).toBe(false);
    expect(c.ready_to_send).toBe(false);
  });

  it("kênh hệ thống tắt ⇒ chặn cả hai hướng, không có nút (hệ thống làm)", () => {
    const c = partnerChecklist(admin, { ...hub, channel: false });
    expect(state(c, "channel")?.state).toBe("todo");
    expect(state(c, "channel")?.fix).toBeUndefined();
    expect(c.ready_to_send || c.ready_to_receive).toBe(false);
  });
});
