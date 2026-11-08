// QC · qc-community-flow · hành trình "quản trị community sửa flow Duyệt bài trên canvas → Lưu và áp dụng" (stack community-web + ai-admin, CS_ADMIN_URL).
// Lỗi B1 (docs/specs/qc-community-flow/tasks.md) đã sửa ở cr125-c5-template-readiness: mẫu dùng được ở công ty (readiness) + seed D7.
import { expect, test } from "@playwright/test";
import { flowRow, loginTenantAdminUi, openCompanyFlows } from "../_kit/ui";

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
  // CR-125 c5 · công ty Community có sẵn flow "Quản trị duyệt bài" (seed bật Community ⇒ cùng có flow dùng được, D7); sao chép ⇒ áp dụng được.
  const rows = flowRow(box, "Quản trị duyệt bài");
  if ((await rows.count()) < 2)
    await rows.first().getByRole("button", { name: "Sao chép để sửa" }).click();
  await expect(rows).toHaveCount(2);
  await rows
    .last()
    .getByRole("link", { name: /^(Mở|Sửa)/ })
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
