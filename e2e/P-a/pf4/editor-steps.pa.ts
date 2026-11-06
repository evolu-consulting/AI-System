// CR-121 c17b · e2e P-a PF4 (VIẾT, CHƯA CHẠY — chạy một lần cuối đợt): trình sửa theo artboard Tpl-Editor.
// platform_admin: Sơ đồ mặc định, chuyển "Danh sách" (nhớ sau khi tải lại), bộ đếm n/20, "Chỉ chạy khi", "Xuất bản vN+1", "X công ty đang dùng vN".
// tenant_admin: bản thư viện chỉ xem có tab "Lượt chạy"; bản riêng sau Sao chép ghi "Lưu là áp dụng ngay…" và không có Xuất bản.
import { expect, type Page, test } from "@playwright/test";
import { seedAdmin } from "../../support/helpers";
import { ACME, ADMIN_URL, adminLogin, settle, withSql } from "../_pa-support";

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

const libraryId = () =>
  withSql(
    async (sql) =>
      (
        await sql`select id::text as id from hub.process_defs
          where tenant_id is null and slot = 'contracts.approval' and published_version is not null and deleted_at is null
          order by created_at limit 1`
      )[0]?.id as string,
  );

test("CR-121 c17b · platform: Sơ đồ mặc định, Danh sách nhớ lại, n/20, Chỉ chạy khi, Xuất bản vN+1", async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  try {
    const id = await libraryId();
    await platformLogin(p);
    await p.goto(`${ADMIN_URL}/processes/${id}`);
    const toolbar = p.getByTestId("library-toolbar");
    await expect(p.getByRole("application", { name: "Canvas quy trình" })).toBeVisible(); // Sơ đồ mặc định
    await expect(toolbar.getByRole("button", { name: /^Xuất bản v\d+$/ })).toBeVisible();
    await expect(toolbar).toContainText(/công ty đang dùng v\d+/);
    await toolbar.getByRole("button", { name: "Danh sách" }).click();
    await expect(p.getByTestId("flow-form")).toBeVisible();
    await expect(p.getByTestId("flow-counter")).toHaveText(/^\d+\/20$/);
    await expect(p.getByText("Chỉ chạy khi").first()).toBeVisible();
    await p.reload();
    await expect(p.getByTestId("flow-form")).toBeVisible(); // nhớ theo người dùng (processView)
    await p.evaluate(() => localStorage.removeItem("processView"));
  } finally {
    await ctx.close();
  }
});

test("CR-121 c17b · tenant_admin: thư viện chỉ xem có tab Lượt chạy; bản riêng không có Xuất bản, có ghi chú lưu áp dụng ngay", async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  try {
    const id = await libraryId();
    await adminLogin(p);
    await p.goto(`${ADMIN_URL}/processes/${id}?company=${ACME}`);
    await expect(p.getByRole("tab", { name: "Lượt chạy" })).toBeVisible();
    await p.getByRole("tab", { name: "Lượt chạy" }).click();
    await p.getByRole("tab", { name: "Các bước" }).click();
    const copy = p.getByTestId("library-copy");
    if (await copy.count()) await copy.click();
    else await p.getByTestId("library-open-copy").click();
    // bản riêng: Danh sách = cùng Form bước dọc; ghi chú lưu áp dụng ngay; xem trước bằng HĐ mẫu
    await p.getByTestId("flows-view-list").first().click();
    await expect(p.getByTestId("flow-form")).toBeVisible();
    await expect(p.getByTestId("flow-counter")).toHaveText(/^\d+\/20$/);
    await expect(p.getByTestId("copy-save-note")).toContainText("áp dụng ngay cho lượt chạy mới");
    await expect(p.getByRole("button", { name: "Xem trước bằng HĐ mẫu" })).toBeVisible();
    await p.evaluate(() => localStorage.removeItem("processView"));
    await expect(p.getByRole("button", { name: /^Xuất bản/ })).toHaveCount(0);
  } finally {
    await ctx.close();
  }
});
