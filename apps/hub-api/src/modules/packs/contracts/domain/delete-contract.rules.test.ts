// CR-127 · Z8: luật `canDeleteContract`.
import { describe, expect, it } from "bun:test";
import { canDeleteContract, type DeleteFacts } from "./delete-contract.rules";

const f = (status: string): DeleteFacts => ({
  status,
  created_by: "u-create",
  owner_user_id: "u-owner",
});
const editor = { admin: false, write: true };
const viewer = { admin: false, write: false };
const admin = { admin: true, write: false };

describe("canDeleteContract", () => {
  it("draft: người tạo / người phụ trách (có quyền ghi) / quản trị xoá được; người khác không", () => {
    expect(canDeleteContract(f("draft"), "u-create", editor)).toBe(true);
    expect(canDeleteContract(f("draft"), "u-owner", editor)).toBe(true);
    expect(canDeleteContract(f("draft"), "u-other", admin)).toBe(true);
    expect(canDeleteContract(f("draft"), "u-other", editor)).toBe(false);
    expect(canDeleteContract(f("draft"), null, editor)).toBe(false);
  });
  it("draft: người tạo mà không còn quyền ghi gói ⇒ không", () => {
    expect(canDeleteContract(f("draft"), "u-create", viewer)).toBe(false);
  });
  it("ngoài draft: chỉ quản trị gói (người tạo / phụ trách không đủ)", () => {
    for (const s of ["processing", "done", "reject"]) {
      expect(canDeleteContract(f(s), "u-create", editor)).toBe(false);
      expect(canDeleteContract(f(s), "u-owner", editor)).toBe(false);
      expect(canDeleteContract(f(s), "u-other", admin)).toBe(true);
    }
  });
});
