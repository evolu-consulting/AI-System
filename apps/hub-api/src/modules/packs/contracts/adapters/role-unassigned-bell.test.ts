import { describe, expect, it } from "bun:test";
import { roleBellBody, roleKeysOfReason } from "./role-unassigned-bell";

describe("CR-182 · chuông «Chưa giao người» (luật thuần)", () => {
  it("lấy khoá vai từ lý do FLOW_GROUP_MISSING; lý do khác / khoá sai ⇒ rỗng", () => {
    expect(roleKeysOfReason("FLOW_GROUP_MISSING:nhom-ab12,nguoi-ky-hop-dong,nhom-ab12")).toEqual([
      "nhom-ab12",
      "nguoi-ky-hop-dong",
    ]);
    expect(roleKeysOfReason("FLOW_REFUSED")).toEqual([]);
    expect(roleKeysOfReason("FLOW_GROUP_MISSING:Bad Key,;")).toEqual([]);
  });
  it("nội dung đúng câu nghiệp vụ", () => {
    expect(roleBellBody("HĐ Mua hàng", ["Người ký hợp đồng"])).toBe(
      "Hợp đồng HĐ Mua hàng đang chờ: vai Người ký hợp đồng chưa giao người.",
    );
  });
});
