// CR-110 · COM-FR-43 · CR-120 · nhóm Sổ Hợp Tác trong Cài đặt chỉ khi chủ quản có quyền gói contracts VÀ server cấp contractsUrl.
import { describe, expect, it } from "bun:test";
import { hasContractsGroup } from "./nav";

describe("hasContractsGroup", () => {
  it("cần cả quyền contracts lẫn contractsUrl", () => {
    expect(hasContractsGroup({ caps: { contracts: true }, contractsUrl: "/" })).toBe(true);
    expect(hasContractsGroup({ caps: { contracts: true }, contractsUrl: null })).toBe(false);
    expect(hasContractsGroup({ caps: { contracts: false }, contractsUrl: "/" })).toBe(false);
  });
});
