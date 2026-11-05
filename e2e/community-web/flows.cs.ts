// CR-120 · cr120-community-flow-ui · HÀNH TRÌNH THẬT (D5, không mock) trên stack community-web + ai-admin:
//  1. Platform admin ở ai-admin gán quy trình "duyệt bài" cho công ty (đường thật, không bật cờ trong seed).
//  2. Đối tác đăng bài ⇒ "Chờ duyệt" ở Bài đăng của tôi (kèm gợi ý sửa) ⇒ chủ quản thấy mục "Duyệt bài" ⇒ duyệt ⇒ bài hiện trên bảng tin.
//  3. Đối tác báo cáo một bài của chủ quản (menu ⋯) ⇒ chủ quản vào "Báo cáo vi phạm", thấy tiêu đề bài + lý do ⇒ Ẩn bài.
import { expect, type Page, test } from "@playwright/test";
import { openAs, postByTitle } from "./_stack";

// biome-ignore lint/suspicious/noUndeclaredEnvVars: biến môi trường của runner e2e (không khai báo trong turbo)
const ADMIN = process.env.CS_ADMIN_URL ?? "";
const RUN = Date.now().toString(36);
const TITLE = `Keo dan duyet ${RUN}`;
const TENANT_NAME = "Demo Sổ Hợp Tác";

async function loginAdmin(page: Page): Promise<void> {
  await page.goto(`${ADMIN}/login`);
  await page.getByRole("textbox", { name: "Mã công ty" }).fill("platform");
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: biến môi trường của runner e2e (không khai báo trong turbo)
  await page
    .getByRole("textbox", { name: "Tên đăng nhập" })
    .fill(process.env.SEED_ADMIN_USERNAME ?? "");
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: biến môi trường của runner e2e (không khai báo trong turbo)
  await page.getByLabel("Mật khẩu", { exact: true }).fill(process.env.SEED_ADMIN_PASSWORD ?? "");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Tổng quan" })).toBeVisible();
}

test.describe.configure({ mode: "serial" });

test("1 · platform admin gán quy trình duyệt bài cho công ty (đường thật)", async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "vi-VN", viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await loginAdmin(page);
  await page
    .getByRole("navigation", { name: "Điều hướng chính" })
    .getByRole("list", { name: "Danh sách công ty" })
    .getByRole("link", { name: new RegExp(TENANT_NAME) })
    .click();
  await page.getByRole("tab", { name: "Ứng dụng & Gói" }).click();
  const box = page
    .getByTestId("tenant-processes-community")
    .getByTestId("admin-assigned-community.post-moderation");
  await expect(box).toBeVisible();
  if ((await box.getByTestId(/^admin-assigned-[0-9a-f-]{36}$/).count()) === 0) {
    const pick = box.getByTestId("admin-assign-pick");
    const v = await pick.locator("option[value]:not([value=''])").first().getAttribute("value");
    expect(v, "thư viện có ít nhất một quy trình duyệt bài").toBeTruthy();
    await pick.selectOption(v as string);
    await box.getByTestId("admin-assign-add").click();
  }
  await expect(box.getByTestId(/^admin-assigned-[0-9a-f-]{36}$/)).toHaveCount(1);
  await ctx.close();
});

test("2 · đối tác đăng ⇒ Chờ duyệt ⇒ chủ quản duyệt ở Duyệt bài ⇒ bài hiện", async ({
  browser,
}) => {
  const sup = await openAs(browser, "supplier");
  await sup.page.goto("/community");
  await sup.page
    .getByTestId("composer")
    .getByRole("button", { name: /đang có hàng/ })
    .click();
  await sup.page
    .getByTestId("composer")
    .getByRole("button", { name: "Cần bán", exact: true })
    .click();
  await sup.page.getByLabel("Hàng hoá", { exact: true }).fill(TITLE);
  await sup.page.getByLabel("Số lượng").fill("3 thùng");
  await sup.page.getByRole("button", { name: "Đăng bài" }).click();

  // Bài của tôi: "Chờ duyệt" + lý do/bước kế + gợi ý sửa
  await sup.page.goto("/community/profile");
  const mine = postByTitle(sup.page, TITLE);
  await expect(mine.getByTestId("mod-label")).toHaveText("Chờ duyệt");
  await expect(mine.getByTestId("mod-hint")).toHaveText("Sửa nội dung sẽ gửi duyệt lại.");

  // Chủ quản: có mục "Duyệt bài" (khe đã bật), bài nằm trong hàng chờ, duyệt
  const host = await openAs(browser, "host");
  await host.page.goto("/community");
  await expect(host.page.getByTestId("nav-community-review")).toBeVisible();
  await host.page.getByTestId("nav-community-review").click();
  const item = host.page.getByTestId("review-item").filter({ hasText: TITLE });
  await expect(async () => {
    await host.page.reload();
    await expect(item.getByTestId("review-approve")).toBeVisible({ timeout: 4_000 });
  }).toPass({ timeout: 120_000 });
  await item.getByTestId("review-approve").click();
  await expect(item).toHaveCount(0);

  await host.page.goto("/community");
  await expect(postByTitle(host.page, TITLE).first()).toBeVisible();
  await sup.page.goto("/community/profile");
  await expect(postByTitle(sup.page, TITLE).getByTestId("mod-label")).toHaveText("Đã duyệt");
  await sup.ctx.close();
  await host.ctx.close();
});

test("3 · đối tác báo cáo một bài ⇒ chủ quản Ẩn bài ở Báo cáo vi phạm", async ({ browser }) => {
  const buyer = await openAs(browser, "buyer");
  await buyer.page.goto("/community");
  const target = buyer.page.getByTestId("post").filter({ hasText: "Lịch nghỉ lễ 20/11" }).first();
  await target.getByRole("button", { name: "Tuỳ chọn bài đăng" }).click();
  await target.getByTestId("post-report").click();
  const dlg = buyer.page.getByTestId("report-dialog");
  await dlg.getByTestId("reason-submit").click();
  await expect(dlg.getByTestId("reason-error")).toBeVisible(); // thiếu lý do ⇒ nói cách sửa
  await dlg.getByTestId("reason-input").fill(`Nội dung không phù hợp ${RUN}`);
  await dlg.getByTestId("reason-submit").click();
  await expect(dlg).toHaveCount(0);

  const host = await openAs(browser, "host");
  await host.page.goto("/community");
  await host.page.getByTestId("nav-community-reports").click();
  const rep = host.page
    .getByTestId("report-item")
    .filter({ hasText: `Nội dung không phù hợp ${RUN}` });
  await expect(rep).toBeVisible();
  await expect(rep.getByTestId("report-post-title")).toContainText("Lịch nghỉ lễ 20/11");
  await rep.getByTestId("report-hide").click();
  await expect(rep.getByTestId("report-hide")).toHaveCount(0);
  await buyer.ctx.close();
  await host.ctx.close();
});
