// ADM-FR-65 · e2e P-a PF4 · E-P15a (test-plan-e2e §2): CR-121 c15 viết lại theo luồng mới — hộp "Tạo quy trình" theo công ty (chép mẫu sdlc
// ở /processes của tenant_admin) đã gỡ ở c13 và công ty nhận quy trình qua Sao chép ở Công ty › Quy trình (c11) ⇒ ca "Chép mẫu ⇒ dòng tắt ⇒
// bật báo lỗi Group kiểm" không còn luồng để lái, XOÁ (lý do: không còn chỗ tạo quy trình theo công ty ở /processes).
// Còn: Adm thấy nav "Quy trình" và vào Công ty › Quy trình của công ty mình; member không có nav; platform_admin thấy Thư viện đối chiếu
// artboard Library (5 cột, ô tìm, bấm dòng ⇒ trình sửa ở canvas).
import { expect, type Page, test } from "@playwright/test";
import { seedAdmin } from "../../support/helpers";
import { ADMIN_URL, adminLogin, settle } from "../_pa-support";

test.afterEach(() => settle());

async function platformLogin(p: Page): Promise<void> {
  const a = seedAdmin();
  await p.goto(`${ADMIN_URL}/login`);
  await p.getByRole("textbox", { name: "Mã công ty" }).fill("platform");
  await p.getByRole("textbox", { name: "Tên đăng nhập" }).fill(a.username);
  await p.getByLabel("Mật khẩu", { exact: true }).fill(a.password);
  await p.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await p.waitForURL((u) => !u.pathname.startsWith("/login"));
}

test('ADM-FR-65 · E-P15a · Adm: nav "Quy trình" ⇒ Công ty › Quy trình; member không có nav', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  try {
    await adminLogin(p);
    const nav = p.getByRole("link", { name: "Quy trình", exact: true });
    await expect(nav).toBeVisible();
    await nav.click();
    await expect(p).toHaveURL(/\/tenants\/[^/?]+\?.*tab=processes/);
    const m = await browser.newContext();
    const mp = await m.newPage();
    await adminLogin(mp, "A").catch(() => undefined);
    await expect(mp.getByRole("link", { name: "Quy trình", exact: true })).toHaveCount(0);
    await m.close();
  } finally {
    await ctx.close();
  }
});

test("CR-121 c15 · Thư viện: 5 cột, tìm, bấm dòng ⇒ trình sửa canvas", async ({ browser }) => {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  try {
    await platformLogin(p);
    await p.getByRole("link", { name: "Quy trình", exact: true }).click();
    await expect(p.getByRole("heading", { level: 1, name: "Thư viện quy trình" })).toBeVisible();
    const table = p.getByRole("table", { name: "Quy trình" });
    for (const h of ["Quy trình", "Các bước", "Dùng bởi", "Trạng thái", "Cập nhật"])
      await expect(table.getByRole("columnheader", { name: h })).toBeVisible();
    // không lộ khái niệm kỹ thuật (khe/def/slot) ở nhãn cột
    await expect(table).not.toContainText(/\b(slot|def)\b/i);

    // ô tìm: khớp tên → còn dòng; không khớp → thông báo
    const search = p.getByRole("searchbox", { name: "Tìm quy trình" });
    await search.fill("Quy trình HĐ mặc định");
    await search.press("Enter");
    const base = table.getByRole("row").filter({ hasText: "Quy trình HĐ mặc định" }).first();
    await expect(base).toBeVisible();
    await expect(base.getByRole("img").first()).toBeVisible(); // chip tên bước
    await search.fill("khong-co-quy-trinh-nay-zzz");
    await search.press("Enter");
    await expect(p.getByText("Không có quy trình nào khớp bộ lọc.")).toBeVisible();
    await search.fill("Quy trình HĐ mặc định");
    await search.press("Enter");

    // bấm dòng ⇒ trình sửa, mặc định canvas
    await table
      .getByRole("row")
      .filter({ hasText: "Quy trình HĐ mặc định" })
      .first()
      .getByRole("cell")
      .nth(2)
      .click();
    await expect(p).toHaveURL(/\/processes\/[0-9a-f-]{36}/);
    await expect(p.getByRole("application", { name: "Canvas quy trình" })).toBeVisible();
  } finally {
    await ctx.close();
  }
});
