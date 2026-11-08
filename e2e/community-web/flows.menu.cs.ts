// CR-125 · c6 · B3/B4 · quản trị community mở trình sửa flow "Duyệt bài" (stack community-web + ai-admin, đường thật):
// menu "+ Thêm bước" có bước nghiệp vụ của community + Kết thúc theo kết quả Hiện bài / Ẩn bài, KHÔNG có bước hợp đồng / "Nâng cao";
// hộp bật quy trình, dòng trạng thái ở chân trang, thẻ Giới hạn nói "bài đăng" (record.label của sự kiện), không còn chữ "hợp đồng".
import { expect, test } from "@playwright/test";
import { enableFlowTriggers } from "../_kit/flows";
import {
  assignFlowUi,
  flowRows,
  loginPlatformAdminUi,
  loginTenantAdminUi,
  openCompanyFlows,
  openTenantAppsTab,
} from "../_kit/ui";
import { TENANT } from "./_stack";

// biome-ignore lint/suspicious/noUndeclaredEnvVars: biến môi trường của runner e2e (không khai báo trong turbo)
const ADMIN = process.env.CS_ADMIN_URL ?? "";
// biome-ignore lint/suspicious/noUndeclaredEnvVars: biến môi trường của runner e2e (không khai báo trong turbo)
const OWNER_PW = process.env.DEMO_OWNER_PW ?? "";
const TENANT_NAME = "Demo Sổ Hợp Tác";
const NO_CONTRACT = /hợp đồng/i;

test("quản trị community: menu + chữ trong trình sửa flow Duyệt bài đúng ngôn ngữ community", async ({
  browser,
}, testInfo) => {
  test.setTimeout(240_000);
  // chuẩn bị bằng đường thật: platform gán quy trình duyệt bài (đã gán rồi thì bỏ qua) + cờ quy trình mới
  const pctx = await browser.newContext({
    locale: "vi-VN",
    viewport: { width: 1440, height: 900 },
  });
  const pp = await pctx.newPage();
  await loginPlatformAdminUi(
    pp,
    ADMIN,
    process.env.SEED_ADMIN_USERNAME ?? "",
    process.env.SEED_ADMIN_PASSWORD ?? "",
  );
  await openTenantAppsTab(pp, TENANT_NAME);
  const pbox = await openCompanyFlows(pp);
  const names = await pbox
    .getByRole("combobox", { name: "Quy trình trong Thư viện" })
    .locator("option[value]:not([value=''])")
    .allTextContents();
  const moderation = names.find((n) => /bài/i.test(n));
  if (moderation) await assignFlowUi(pbox, moderation);
  await expect(flowRows(pbox).filter({ hasText: /bài/i })).not.toHaveCount(0);
  await enableFlowTriggers(TENANT);
  await pctx.close();

  const ctx = await browser.newContext({ locale: "vi-VN", viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await loginTenantAdminUi(page, ADMIN, "demo", "demo-owner", OWNER_PW);
  await page.getByRole("link", { name: "Công ty" }).first().click();
  const box = await openCompanyFlows(page);

  // B4 · khối "quy trình mới" (c2: không còn công tắc, chỉ nút Tạm dừng): lời trạng thái + hộp xác nhận nói "bài đăng", không "hợp đồng"
  await expect(box.getByTestId("flow-switch-status")).toContainText("bài đăng");
  // công ty demo CÓ cả flow Sổ Hợp Tác đang bật (seed) ⇒ khối này là công tắc chung của công ty và nêu đủ các bản ghi nó chạy
  // ("bài đăng và hợp đồng" là đúng); chỉ phần trong trình sửa MỘT flow community (bên dưới) mới phải không nhắc hợp đồng.
  await box.getByTestId("flow-pause").click();
  const ask = page.getByTestId("flow-pause-confirm");
  await expect(ask).toContainText(/Từ giờ .*bài đăng.* sẽ chạy theo cách cũ/);
  await page.screenshot({ path: testInfo.outputPath("c6-switch-on.png") });
  await ask.getByRole("button", { name: "Huỷ" }).click();

  // mở bản sao của flow "Quản trị duyệt bài" (flow mặc định của công ty Community, D7; sao chép nếu chưa có)
  const rows = flowRows(box).filter({ hasText: "Quản trị duyệt bài" });
  if ((await rows.count()) < 2) {
    await rows.first().getByRole("button", { name: "Sao chép để sửa" }).click();
    await page.getByTestId("copy-confirm").click(); // CR-125 c5b · hộp Sao chép nói mẫu dùng được trước khi sao chép
  }
  await expect(rows).toHaveCount(2);
  await rows
    .last()
    .getByRole("link", { name: /^(Mở|Sửa)/ })
    .click();
  // thứ tự hàng không cố định: nếu mở trúng bản dùng chung (chỉ xem) thì sang "bản riêng" của công ty
  const own = page.getByRole("link", { name: "Mở bản riêng" });
  await expect(page.getByTestId("flow-add-step").or(own)).toBeVisible({ timeout: 30_000 });
  if (await own.isVisible()) await own.click();
  await expect(page.getByTestId("flow-add-step")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("[data-stage-uid]").first()).toBeVisible({ timeout: 30_000 });

  // B3 · menu "+ Thêm bước"
  await page.getByTestId("flow-add-step").click();
  const menu = page.getByRole("menu");
  // c6b · MỘT lối đăng bài: chỉ "Kết thúc · Hiện bài" (không thêm mục "Hiện bài" riêng)
  await expect(menu.getByTestId("flow-node-community.show-post")).toHaveCount(0);
  await expect(menu.getByRole("menuitem", { name: /Hiện bài/ })).toHaveCount(1);
  await expect(menu.getByRole("menuitem", { name: /Ẩn bài/ })).toHaveCount(1);
  await expect(menu.getByTestId("flow-node-finish-shown")).toHaveText("Kết thúc · Hiện bài");
  await expect(menu.getByTestId("flow-node-finish-hidden")).toHaveText("Kết thúc · Ẩn bài");
  for (const id of [
    "contracts.esign",
    "contracts.partner-send",
    "finish-approved",
    "finish-rejected",
  ])
    await expect(menu.getByTestId(`flow-node-${id}`)).toHaveCount(0);
  await expect(menu.getByText("Nâng cao", { exact: true })).toHaveCount(0);
  await expect(menu).not.toContainText(NO_CONTRACT);
  await page.screenshot({ path: testInfo.outputPath("c6-add-menu.png") });
  await page.keyboard.press("Escape");

  // B4 · thẻ Giới hạn + dòng trạng thái chân trang + panel bước: chữ community, không nhắc "Nâng cao"
  await expect(page.getByText(/Khi bài đăng chờ quá \d+ ngày/)).toBeVisible();
  const status = page.getByTestId("apply-status").first();
  await expect(status).toContainText("bài đăng");
  await expect(status).not.toContainText(NO_CONTRACT);
  // mở lần lượt từng bước của bản sao (bản sao có thể đã được sửa ở ca khác) — không bước nào được nhắc tới "Nâng cao"
  const steps = page.locator("[data-stage-uid]");
  for (let i = 0; i < Math.min(await steps.count(), 4); i++) {
    await steps.nth(i).click();
    await expect(page.getByText(/Chỉnh chi tiết ở/)).toHaveCount(0);
  }
  await page.screenshot({ path: testInfo.outputPath("c6-editor.png"), fullPage: true });
  await ctx.close();
});
