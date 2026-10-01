// ADM-FR-62 · M3-R23, R24 · e2e danh sách Groups (test-plan E-GL). Nhãn nguyên văn plan-frontend §5.
// Dữ liệu: fixture M1 + M3 (acme: beta-testers, ke-toan [3 người, 1 feature], kinh-doanh).
import { expect, type Page, test } from "@playwright/test";
import { loginAdmin, loginAs, openPage, resetFixture, toast } from "./support/helpers";

test.describe.configure({ mode: "serial" });
test.beforeEach(() => {
  resetFixture();
});

const keyIn = (key: string) => new RegExp(`(?<![\\w-])${key}(?![\\w-])`);
const groupRow = (page: Page, key: string) =>
  page
    .getByRole("table", { name: "Groups" })
    .getByRole("row")
    .filter({ hasText: keyIn(key) });
const rowMenu = async (page: Page, key: string, item: string) => {
  await groupRow(page, key).getByRole("button", { name: "Thao tác khác" }).click();
  await page.getByRole("menuitem", { name: item, exact: true }).click();
};

test("ADM-FR-62 · M3-R24 · tenant_admin binh: menu có link 'Groups' và 'Phân quyền'; vào Groups thấy heading, bảng, '+ Tạo group'; không có combobox Tenant; chỉ group acme", async ({
  page,
}) => {
  await loginAs(page, "acme", "binh");
  const nav = page.getByRole("navigation");
  await expect(nav.getByRole("link", { name: "Phân quyền" })).toBeVisible();
  await nav.getByRole("link", { name: "Groups" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Groups" })).toBeVisible();
  await expect(page.getByRole("link", { name: "+ Tạo group" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Tenant" })).toHaveCount(0);
  await expect(groupRow(page, "ke-toan")).toHaveCount(1);
  await expect(page.getByRole("table", { name: "Groups" })).not.toContainText("globex");
});

test("ADM-FR-62 · M3-R06 · platform admin: có combobox Tenant; chưa chọn → 'Chọn một tenant để xem group của tenant đó.' và KHÔNG gọi /admin/groups; chọn acme → có bảng", async ({
  page,
}) => {
  const calls: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/admin/groups")) calls.push(r.url());
  });
  await loginAdmin(page);
  await openPage(page, "/groups", "Groups");
  await expect(page.getByText("Chọn một tenant để xem group của tenant đó.")).toBeVisible();
  expect(calls).toEqual([]);
  await page.getByRole("combobox", { name: "Tenant" }).click();
  await page.getByRole("option", { name: /acme/i }).click();
  await expect(groupRow(page, "ke-toan")).toBeVisible();
  expect(calls.length).toBeGreaterThan(0);
});

test("ADM-FR-62 · M3-R02 · acme: beta-testers có 'Có sẵn' + 'Thấy các feature đang Beta'; ke-toan 3 thành viên, 1 feature, Agent '—'; có kinh-doanh", async ({
  page,
}) => {
  await loginAs(page, "acme", "binh");
  await openPage(page, "/groups", "Groups");
  const beta = groupRow(page, "beta-testers");
  await expect(beta.getByText("Có sẵn")).toBeVisible();
  await expect(beta.getByText("Thấy các feature đang Beta")).toBeVisible();
  const kt = groupRow(page, "ke-toan");
  await expect(kt.getByRole("cell").nth(1)).toContainText("3");
  await expect(kt.getByRole("cell").nth(2)).toContainText("1");
  await expect(kt.getByRole("cell").nth(3)).toContainText("—");
  await expect(groupRow(page, "kinh-doanh")).toBeVisible();
});

test("ADM-FR-62 · M3-R23 · ô tìm 'Tìm theo tên, key…' lọc theo tên/key; không khớp → empty state có 'Xoá bộ lọc'", async ({
  page,
}) => {
  await loginAs(page, "acme", "binh");
  await openPage(page, "/groups", "Groups");
  const search = page.getByRole("searchbox", { name: "Tìm theo tên, key…" });
  await search.fill("kinh");
  await expect(groupRow(page, "kinh-doanh")).toBeVisible();
  await expect(groupRow(page, "ke-toan")).toHaveCount(0);
  await search.fill("khong-co-group-nay");
  await expect(page.getByRole("button", { name: "Xoá bộ lọc" })).toBeVisible();
  await page.getByRole("button", { name: "Xoá bộ lọc" }).click();
  await expect(groupRow(page, "ke-toan")).toBeVisible();
});

test("ADM-FR-62 · M3-R02 · menu ⋯ của beta-testers: 'Xoá' có aria-disabled=true; menu của ke-toan: 'Sửa' và 'Xoá'", async ({
  page,
}) => {
  await loginAs(page, "acme", "binh");
  await openPage(page, "/groups", "Groups");
  await groupRow(page, "beta-testers").getByRole("button", { name: "Thao tác khác" }).click();
  await expect(page.getByRole("menuitem", { name: "Xoá", exact: true })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await page.keyboard.press("Escape");
  await groupRow(page, "ke-toan").getByRole("button", { name: "Thao tác khác" }).click();
  await expect(page.getByRole("menuitem", { name: "Sửa", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Xoá", exact: true })).not.toHaveAttribute(
    "aria-disabled",
    "true",
  );
});

test("ADM-FR-62 · M3-R04 · xoá kinh-doanh: alertdialog 'Xoá Kinh doanh?' + gõ 'kinh-doanh' mới bật 'Xoá group' → toast 'Đã xoá Kinh doanh', hàng biến mất, DELETE 204", async ({
  page,
}) => {
  await loginAs(page, "acme", "binh");
  await openPage(page, "/groups", "Groups");
  await rowMenu(page, "kinh-doanh", "Xoá");
  const dialog = page.getByRole("alertdialog", { name: "Xoá Kinh doanh?" });
  const confirm = dialog.getByRole("button", { name: "Xoá group" });
  await expect(confirm).toBeDisabled();
  await dialog.getByRole("textbox", { name: "Gõ kinh-doanh để xác nhận" }).fill("kinh-doanh");
  await expect(confirm).toBeEnabled();
  const deleted = page.waitForResponse(
    (r) => r.url().includes("/admin/groups/") && r.request().method() === "DELETE",
  );
  await confirm.click();
  expect((await deleted).status()).toBe(204);
  await expect(toast(page, "Đã xoá Kinh doanh")).toBeVisible();
  await expect(groupRow(page, "kinh-doanh")).toHaveCount(0);
});
