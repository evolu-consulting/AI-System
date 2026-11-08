// QC · qc-community-flow · hành trình "quản trị community sửa flow Duyệt bài trên canvas → Lưu và áp dụng" (stack community-web + ai-admin, CS_ADMIN_URL).
// Hiện ĐỎ có chủ đích: Lưu bị chặn "Tính năng này chưa bật cho công ty" (xem docs/specs/qc-community-flow/tasks.md, lỗi B1). Xanh khi lỗi được sửa.
import { expect, test } from "@playwright/test";
import { loginTenantAdminUi, openCompanyFlows } from "../_kit/ui";

// biome-ignore lint/suspicious/noUndeclaredEnvVars: biến e2e
const ADMIN = process.env.CS_ADMIN_URL ?? "";
// biome-ignore lint/suspicious/noUndeclaredEnvVars: biến e2e
const OWNER_PW = process.env.DEMO_OWNER_PW ?? "";

test("quản trị community: sao chép flow Duyệt bài, thêm bước Duyệt, Lưu và áp dụng được", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const page = await (
    await browser.newContext({ locale: "vi-VN", viewport: { width: 1600, height: 1000 } })
  ).newPage();
  await loginTenantAdminUi(page, ADMIN, "demo", "demo-owner", OWNER_PW);
  await page.getByRole("link", { name: "Công ty" }).first().click();
  const box = await openCompanyFlows(page);
  if ((await box.getByRole("link", { name: /^(Mở|Sửa)/ }).count()) < 2)
    await box.getByRole("button", { name: "Sao chép để sửa" }).first().click();
  await box
    .getByRole("link", { name: /^(Mở|Sửa)/ })
    .last()
    .click();
  const nodes = page.locator("[data-stage-uid]");
  await expect(nodes.first()).toBeVisible({ timeout: 30_000 });
  const pane = page.locator(".react-flow__pane").first();
  const pb = await pane.boundingBox();
  if (!pb) throw new Error("không thấy canvas");
  const before = await nodes.count();
  await page.getByTestId("flow-add-step").click();
  await page
    .getByRole("menuitem", { name: /^Duyệt/ })
    .first()
    .dragTo(pane, { targetPosition: { x: pb.width * 0.5, y: pb.height * 0.2 }, force: true });
  await expect(nodes).toHaveCount(before + 1);
  await page.getByRole("button", { name: "Lưu và áp dụng" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /Chưa lưu được/ })).toHaveCount(0);
});
