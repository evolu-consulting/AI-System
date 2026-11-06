import { describe, expect, test } from "bun:test";
import {
  companySearch,
  copyTenantId,
  isCompanyCopy,
  scopedTenantId,
  usesStepForm,
  viewerTenantId,
} from "./company-copy";

describe("CR-121 c17b · bản riêng dùng Form bước dọc chung", () => {
  const copy = { source_template_id: "s1", slot_body: { steps: [] } };
  test("bản riêng có slot_body ⇒ dùng Form; editor thư viện (lib) ⇒ không", () => {
    expect(isCompanyCopy(copy, null)).toBe(true);
    expect(usesStepForm(copy, null)).toBe(copy);
    expect(usesStepForm(copy, {})).toBeNull();
  });
  test("không nguồn thư viện, hoặc chưa có slot_body ⇒ chỉ Sơ đồ (không Form)", () => {
    expect(usesStepForm({ source_template_id: null, slot_body: {} }, null)).toBeNull();
    expect(usesStepForm({ source_template_id: "s1" }, null)).toBeNull();
    expect(usesStepForm(undefined, null)).toBeNull();
  });
});

describe("CR-121 f2 · công ty của dòng 'Sao từ thư viện' lấy từ chính def", () => {
  test("copyTenantId = tenant_id của bản riêng; thiếu ⇒ undefined (không nhờ ?company= hay công ty đang chọn)", () => {
    expect(copyTenantId({ tenant_id: "t1" })).toBe("t1");
    expect(copyTenantId({ tenant_id: null })).toBeUndefined();
    expect(copyTenantId(undefined)).toBeUndefined();
  });
  test("viewerTenantId: tenant_admin = công ty của phiên (hook không có tenantId), platform = công ty đang chọn", () => {
    expect(viewerTenantId(false, undefined, "own")).toBe("own");
    expect(viewerTenantId(true, "picked", "platform")).toBe("picked");
    expect(viewerTenantId(true, undefined, "platform")).toBeUndefined();
  });
});

describe("CR-121 f14 · platform mở bản riêng/lượt chạy của công ty", () => {
  test("link mang công ty; không có ⇒ không thêm tham số", () => {
    expect(companySearch("t1")).toEqual({ company: "t1" });
    expect(companySearch(undefined)).toEqual({});
    expect(companySearch(null)).toEqual({});
  });
  test("công ty để đọc: platform theo ?company=, tenant_admin giữ nguyên (Hub suy từ phiên)", () => {
    expect(scopedTenantId(true, undefined, "t1")).toBe("t1");
    expect(scopedTenantId(true, "picked", undefined)).toBe("picked");
    expect(scopedTenantId(false, undefined, "t1")).toBeUndefined();
  });
});
