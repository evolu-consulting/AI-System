// UAT H4b-1 phần B: xoá secret đang dùng (sau khi K1 tạo kết nối + tick agent)
import { launch, studioLogin, mkSnap, mkStep, expect } from "./lib.mjs";
const OUT = process.argv[2];
const { browser, page } = await launch(OUT);
const snap = mkSnap(OUT);
const { step, save } = mkStep(OUT, () => ({ A: page }), snap);
await studioLogin(page);
await step("H01", "Xoá secret kh-main đang được kết nối dùng → chặn ngay, nêu nơi dùng (KnowledgeHub · kh-main)", async () => {
  await page.goto("http://localhost:3200/studio/secrets");
  await page.getByRole("tablist", { name: "Loại secret" }).getByRole("tab", { name: "Khoá KnowledgeHub" }).click();
  const row = page.getByRole("table", { name: "Danh sách secret" }).getByRole("row").filter({ hasText: "kh-main" });
  await expect(row).toContainText("KnowledgeHub");
  await snap(page, "20-A-kh-in-use-badge");
  await row.getByRole("button", { name: "Xoá" }).click();
  const dlg = page.getByRole("alertdialog", { name: "Không xoá được kh-main" });
  await expect(dlg).toBeVisible();
  await expect(dlg).toContainText("KnowledgeHub · kh-main");
  await snap(page, "21-A-kh-delete-blocked");
  await dlg.getByRole("button", { name: "Đóng" }).click();
  await expect(row).toBeVisible();
});
await step("H02", "Secret chưa dùng (kh-wrong) vẫn xoá được; secret anthropic-main (provider) hiển thị Chưa dùng", async () => {
  await page.getByRole("tablist", { name: "Loại secret" }).getByRole("tab", { name: "Provider API key" }).click();
  await expect(page.getByRole("table", { name: "Danh sách secret" }).getByRole("row").filter({ hasText: "anthropic-main" })).toContainText("Chưa dùng");
  await snap(page, "22-A-provider-unused");
});
save(); await browser.close();
