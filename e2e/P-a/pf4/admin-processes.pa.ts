// ADM-FR-65 · e2e P-a PF4 · E-P15a (test-plan-e2e §2): CR-121 c15 viết lại theo luồng mới — hộp "Tạo quy trình" theo công ty (chép mẫu sdlc
// ở /processes của tenant_admin) đã gỡ ở c13 và công ty nhận quy trình qua Sao chép ở Công ty › Quy trình (c11) ⇒ ca "Chép mẫu ⇒ dòng tắt ⇒
// bật báo lỗi Group kiểm" không còn luồng để lái, XOÁ (lý do: không còn chỗ tạo quy trình theo công ty ở /processes).
// Còn: Adm thấy nav "Quy trình" và vào Công ty › Quy trình của công ty mình; member không có nav; platform_admin thấy Thư viện đối chiếu
// artboard Library (5 cột, ô tìm, bấm dòng ⇒ trình sửa ở canvas).
import { expect, test } from "@playwright/test";
import { ADMIN_URL, adminLogin, settle } from "../_pa-support";

test.afterEach(() => settle());

test('ADM-FR-65 · E-P15a · Adm: nav "Quy trình" ⇒ Công ty › Quy trình; member không có nav', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  try {
    await adminLogin(p);
    // CR-121 R2: tenant_admin không còn mục sidebar Quy trình — vào Công ty (công ty mình) › tab Quy trình.
    await expect(p.getByRole("link", { name: "Quy trình", exact: true })).toHaveCount(0);
    await p.getByRole("link", { name: "Công ty", exact: true }).click();
    await expect(p).toHaveURL(/\/tenants\/[^/?]+/);
    await p.getByRole("tab", { name: "Quy trình" }).click();
    await expect(p.getByRole("tab", { name: "Quy trình", selected: true })).toBeVisible();
    const m = await browser.newContext();
    const mp = await m.newPage();
    await adminLogin(mp, "A").catch(() => undefined);
    await expect(mp.getByRole("link", { name: "Công ty", exact: true })).toHaveCount(0);
    await m.close();
  } finally {
    await ctx.close();
  }
});
