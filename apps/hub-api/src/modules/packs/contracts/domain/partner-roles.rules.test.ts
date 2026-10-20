// V2-C · BA 5.6b/d · HD-10: luật thuần vai đối tác.
import { describe, expect, it } from "bun:test";
import { NEW_PARTNER_LABEL } from "@ai/contracts";
import { isNewRole, lookupKey, lookupResult, ROLE_OF_DEAL } from "./partner-roles.rules";

describe("V2-C partner-roles.rules", () => {
  it("5.6b vai theo loại HĐ", () => {
    expect(ROLE_OF_DEAL).toEqual({
      buy: "supplier",
      sell: "customer",
      referral: "commission_payer",
    });
  });

  it("5.6d MỚI khi số việc < tối thiểu", () => {
    expect([isNewRole(0, 3), isNewRole(2, 3), isNewRole(3, 3), isNewRole(0, 0)]).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });

  it("khoá gợi ý = khoá trigger: MST thắng, tên không phân biệt hoa thường/dấu", () => {
    expect(lookupKey("CÔNG TY abc", undefined)).toBe(lookupKey("Công ty ABC", ""));
    expect(lookupKey("Công ty ABC", "0311-110-009")).toBe("tax:0311110009");
    expect(lookupKey("   ", undefined)).toBeNull();
  });

  it("HD-10: chưa có ⇒ nhãn mới; có ⇒ vai/MỚI/has_role", () => {
    expect(lookupResult("name:x", null, "referral", null)).toEqual({
      status: "new",
      party: "name:x",
      role: "commission_payer",
      label: NEW_PARTNER_LABEL,
    });
    const hit = {
      party: "tax:1",
      name: "A",
      tax_id: "1",
      roles: [{ role: "supplier" as const, is_new: false }],
    };
    const buy = lookupResult("tax:1", hit, "buy", { score: 80, band: "fair" });
    expect(buy).toMatchObject({ status: "existing", has_role: true, is_new: false, score: 80 });
    const sell = lookupResult("tax:1", hit, "sell", null);
    expect(sell).toMatchObject({ role: "customer", has_role: false, is_new: true, score: null });
    expect(lookupResult("tax:1", hit, undefined, null)).toMatchObject({
      role: null,
      is_new: false,
    });
  });
});
