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
  if ((await rows.count()) < 2) {
    await rows.first().getByRole("button", { name: "Sao chép để sửa" }).click();
    await page.getByTestId("copy-confirm").click(); // hộp Sao chép: mẫu dùng được ⇒ xác nhận
  }
  await expect(rows).toHaveCount(2);
  await rows
    .last()
    .getByRole("link", { name: /^(Mở|Sửa)/ })
    .click();
  // thứ tự hàng không cố định: nếu mở trúng bản dùng chung (chỉ xem) thì sang "bản riêng" của công ty.
  const own = page.getByRole("link", { name: "Mở bản riêng" });
  await expect(page.getByTestId("flow-add-step").or(own)).toBeVisible({ timeout: 30_000 });
  if (await own.isVisible()) await own.click();
  await expect(page.getByTestId("flow-add-step")).toBeVisible({ timeout: 30_000 }); // đang ở bản riêng (sửa được) rồi mới đếm bước
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
  // bước Duyệt mới chưa có người duyệt (không đoán nhóm): mở bước, chọn một người duyệt thật của công ty.
  const ai = page.getByTestId("stage-approve-basics").getByLabel("Ai duyệt");
  if (!(await ai.isVisible()))
    await page.locator("[data-stage-uid]", { hasText: "Bước duyệt mới" }).click();
  await expect(ai).toBeVisible();
  await ai.click();
  await page.getByRole("option").first().click();
  await page.getByRole("button", { name: "Lưu và áp dụng" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /Chưa lưu được/ })).toHaveCount(0);
});
