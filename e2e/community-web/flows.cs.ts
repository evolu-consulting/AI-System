// CR-120 · cr120-community-flow-ui · HÀNH TRÌNH THẬT (D5, không mock) trên stack community-web + ai-admin:
//  1. Platform admin ở ai-admin gán quy trình "duyệt bài" cho công ty (đường thật, không bật cờ trong seed).
//  2. Đối tác đăng bài ⇒ "Chờ duyệt" ở Bài đăng của tôi (kèm gợi ý sửa) ⇒ chủ quản thấy mục "Duyệt bài" ⇒ duyệt ⇒ bài hiện trên bảng tin.
// (Không phụ thuộc thứ tự file: ca 3 tự đăng bài riêng rồi báo cáo/ẩn bài đó, không đụng bài mẫu dùng chung.)
//  3. Đối tác báo cáo một bài của chủ quản (menu ⋯) ⇒ chủ quản vào "Báo cáo vi phạm", thấy tiêu đề bài + lý do ⇒ Ẩn bài.
import { expect, test } from "@playwright/test";
import { assignProcessUi, loginPlatformAdminUi, openTenantAppsTab } from "../_kit/ui";
import { openAs, postByTitle } from "./_stack";

// biome-ignore lint/suspicious/noUndeclaredEnvVars: biến môi trường của runner e2e (không khai báo trong turbo)
const ADMIN = process.env.CS_ADMIN_URL ?? "";
const RUN = Date.now().toString(36);
const TITLE = `Keo dan duyet ${RUN}`;
const TENANT_NAME = "Demo Sổ Hợp Tác";

test.describe.configure({ mode: "serial" });

test("1 · platform admin gán quy trình duyệt bài cho công ty (đường thật)", async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "vi-VN", viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await loginPlatformAdminUi(
    page,
    ADMIN,
    process.env.SEED_ADMIN_USERNAME ?? "",
    process.env.SEED_ADMIN_PASSWORD ?? "",
  );
  await openTenantAppsTab(page, TENANT_NAME);
  const box = page
    .getByTestId("tenant-processes-community")
    .getByTestId("admin-assigned-community.post-moderation");
  await expect(box).toBeVisible();
  await assignProcessUi(box); // thư viện có ít nhất một quy trình duyệt bài; đã gán thì bỏ qua
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
  // Bài RIÊNG của ca này: chủ quản đăng thông báo (mọi bạn bè thấy) có mã chạy duy nhất; ca không đụng bài mẫu dùng chung.
  const NOTE = `Thông báo kiểm thử ${RUN}`;
  const host0 = await openAs(browser, "host");
  await host0.page.goto("/community");
  await host0.page.getByTestId("composer").locator('[data-type="note"]').first().click();
  await host0.page.locator("#draft-body").fill(NOTE);
  await host0.page.getByRole("button", { name: "Đăng bài" }).click();
  await expect(postByTitle(host0.page, NOTE).first()).toBeVisible();
  await host0.ctx.close();

  const buyer = await openAs(browser, "buyer");
  await buyer.page.goto("/community");
  const target = postByTitle(buyer.page, NOTE).first();
  await expect(target).toBeVisible();
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
  await rep.getByTestId("report-hide").click();
  await expect(rep.getByTestId("report-hide")).toHaveCount(0);
  await buyer.ctx.close();
  await host.ctx.close();
});
