// CR-125 · UX-S5 (C4) · HÀNH TRÌNH THẬT (D5, không mock, không bật sẵn trong seed) trên stack community-web + ai-admin:
//  0. Platform admin gán quy trình "Quản trị duyệt bài" cho công ty (đường thật) + bật cờ flow.
//  1. Đối tác đăng bài ⇒ tác giả thấy "Đang chờ duyệt" ⇒ quản trị mở "Bài chờ duyệt" (mục menu có số) ⇒ Duyệt ⇒ bài hiện + tác giả thấy "Đã đăng".
//  2. Đối tác đăng bài ⇒ quản trị Ẩn kèm lý do ⇒ bài không lên bảng tin + tác giả thấy "Đã ẩn — lý do".
import { expect, type Page, test } from "@playwright/test";
import { enableFlowTriggers } from "../_kit/flows";
import {
  assignFlowUi,
  flowRows,
  loginPlatformAdminUi,
  openCompanyFlows,
  openTenantAppsTab,
} from "../_kit/ui";
import { openAs, postByTitle, TENANT } from "./_stack";

// biome-ignore lint/suspicious/noUndeclaredEnvVars: biến môi trường của runner e2e (không khai báo trong turbo)
const ADMIN = process.env.CS_ADMIN_URL ?? "";
const RUN = Date.now().toString(36);
const TENANT_NAME = "Demo Sổ Hợp Tác";
const SHOW = `Keo cho hien ${RUN}`;
const HIDE = `Keo bi an ${RUN}`;
const WHY = `Chưa đủ thông tin ${RUN}`;

test.describe.configure({ mode: "serial" });

async function post(page: Page, title: string): Promise<void> {
  await page.goto("/community");
  const composer = page.getByTestId("composer");
  await composer.getByRole("button", { name: /đang có hàng/ }).click();
  await composer.getByRole("button", { name: "Cần bán", exact: true }).click();
  await page.getByLabel("Hàng hoá", { exact: true }).fill(title);
  await page.getByLabel("Số lượng").fill("3 thùng");
  await page.getByRole("button", { name: "Đăng bài" }).click();
}

test("0 · platform admin gán quy trình duyệt bài + bật cờ (đường thật)", async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "vi-VN", viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await loginPlatformAdminUi(
    page,
    ADMIN,
    process.env.SEED_ADMIN_USERNAME ?? "",
    process.env.SEED_ADMIN_PASSWORD ?? "",
  );
  await openTenantAppsTab(page, TENANT_NAME);
  const box = await openCompanyFlows(page);
  const pick = box.getByRole("combobox", { name: "Quy trình trong Thư viện" });
  const names = await pick.locator("option[value]:not([value=''])").allTextContents();
  const moderation = names.find((n) => /bài/i.test(n));
  if (moderation) await assignFlowUi(box, moderation); // đã gán rồi thì không còn trong ô chọn ⇒ bỏ qua
  await expect(flowRows(box).filter({ hasText: /bài/i })).not.toHaveCount(0);
  await enableFlowTriggers(TENANT);
  await ctx.close();
});

test("1 · đăng ⇒ Đang chờ duyệt ⇒ quản trị Duyệt ở Bài chờ duyệt ⇒ bài hiện, tác giả thấy Đã đăng", async ({
  browser,
}) => {
  test.setTimeout(420_000);
  const sup = await openAs(browser, "supplier");
  await post(sup.page, SHOW);
  await sup.page.goto("/community/profile");
  const mine = postByTitle(sup.page, SHOW);
  await expect(async () => {
    await sup.page.reload();
    await expect(mine.getByTestId("mod-label")).toHaveText("Đang chờ duyệt", { timeout: 4_000 });
  }).toPass({ timeout: 60_000 });

  const host = await openAs(browser, "host");
  await host.page.goto("/community");
  const nav = host.page.getByTestId("nav-community-review");
  await expect(nav).toContainText("Bài chờ duyệt");
  await nav.click();
  const item = host.page.getByTestId("review-item").filter({ hasText: SHOW });
  // bài không kẹt "đang kiểm tra": tới hạn ngắn (flow mở lượt hoặc AI chưa kiểm được) thì có nút Duyệt
  await expect(async () => {
    await host.page.reload();
    await expect(item.getByTestId("review-approve")).toBeVisible({ timeout: 4_000 });
  }).toPass({ timeout: 180_000 });
  await item.getByTestId("review-approve").click();
  await expect(item).toHaveCount(0);

  await host.page.goto("/community");
  await expect(postByTitle(host.page, SHOW).first()).toBeVisible();
  await sup.page.goto("/community/profile");
  await expect(postByTitle(sup.page, SHOW).getByTestId("mod-label")).toHaveText("Đã đăng");
  await sup.ctx.close();
  await host.ctx.close();
});

test("2 · đăng ⇒ quản trị Ẩn kèm lý do ⇒ bài không lên bảng tin, tác giả thấy Đã ẩn — lý do", async ({
  browser,
}) => {
  test.setTimeout(420_000);
  const sup = await openAs(browser, "supplier");
  await post(sup.page, HIDE);

  const host = await openAs(browser, "host");
  await host.page.goto("/community/review");
  const item = host.page.getByTestId("review-item").filter({ hasText: HIDE });
  await expect(async () => {
    await host.page.reload();
    await expect(item.getByTestId("review-reject")).toBeVisible({ timeout: 4_000 });
  }).toPass({ timeout: 180_000 });
  await item.getByTestId("review-reject").click();
  const dlg = host.page.getByTestId("review-reject-dialog");
  await dlg.getByTestId("reason-input").fill(WHY);
  await dlg.getByTestId("reason-submit").click();
  await expect(item).toHaveCount(0);

  await host.page.goto("/community");
  await expect(postByTitle(host.page, HIDE)).toHaveCount(0);
  await sup.page.goto("/community/profile");
  await expect(postByTitle(sup.page, HIDE).getByTestId("mod-label")).toHaveText(`Đã ẩn — ${WHY}`);
  await sup.ctx.close();
  await host.ctx.close();
});
