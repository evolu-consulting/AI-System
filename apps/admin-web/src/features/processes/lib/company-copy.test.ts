import { describe, expect, test } from "bun:test";
import {
  companySearch,
  copyTenantId,
  infoVariant,
  isBusinessView,
  isCompanyCopy,
  isCompanyFlow,
  isCompanyOwned,
  saveModeOf,
  scopedTenantId,
  usesStepForm,
  viewerTenantId,
} from "./company-copy";

describe("CR-123 u9 · công ty không thấy phần kỹ thuật", () => {
  test("bản công ty: người công ty chỉ thấy nghiệp vụ, quản trị nền tảng thấy đủ", () => {
    const own = { source_template_id: "s1" };
    expect(isBusinessView(own, null, false)).toBe(true);
    expect(isBusinessView(own, null, true)).toBe(false);
    expect(isBusinessView({}, null, false)).toBe(false);
  });
});

describe("CR-123 FR-10 · một nút cho công ty, Xuất bản chỉ cho mẫu Thư viện", () => {
  const flow = { tenant_id: "t1", trigger: { event: "x" } };
  test("flow của công ty (kể cả tự tạo) và bản sao thư viện là bản của công ty", () => {
    expect(isCompanyFlow(flow)).toBe(true);
    expect(isCompanyFlow({ trigger: { event: "x" } })).toBe(false);
    expect(isCompanyOwned(flow, { slot: "s" })).toBe(true);
    expect(isCompanyOwned({ source_template_id: "s1" }, null)).toBe(true);
    expect(isCompanyOwned({ trigger: {} }, {})).toBe(false);
    expect(infoVariant(flow, null)).toBe("copy");
  });
  test("công ty: Lưu và áp dụng, không Xuất bản; Thư viện: Lưu nháp + Xuất bản", () => {
    const company = saveModeOf(true, false);
    expect(company.labelKey).toBe("process.admin.editor.saveApply");
    expect(company.noteKey).toBe("process.admin.editor.applyNote");
    expect(company.canPublish).toBe(false);
    const library = saveModeOf(false, true);
    expect(library.canPublish).toBe(true);
    expect(library.noteKey).toBeNull();
  });
});

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

describe("CR-121 f18 · thẻ Thông tin chỉ trường nghiệp vụ", () => {
  test("thư viện ⇒ library; bản riêng ⇒ copy; quy trình thường ⇒ full", () => {
    expect(infoVariant({ source_template_id: "s1" }, {})).toBe("library");
    expect(infoVariant({ source_template_id: "s1" }, null)).toBe("copy");
    expect(infoVariant({ source_template_id: null }, null)).toBe("full");
    expect(infoVariant(undefined, null)).toBe("full");
  });
});
