// Vòng 2 · chép mẫu khi đã có nguồn repo ⇒ tạo def bản chép (required_sections mặc định giữ nguyên).
import { launch, adminLogin, mkSnap, mkStep } from "./lib.mjs";
const OUT = "D:/AI/ai-system/docs/specs/P-c-autofix/evidence/2026-10-14/round2";
const { browser, page } = await launch(OUT); const snap = mkSnap(OUT);
const { step, save } = mkStep(OUT, () => ({ A: page }), snap);
await step("R02", "chép mẫu khi đã có nguồn repo ⇒ def bản chép", async () => {
  await adminLogin(page, "julian.bui", "evolu");
  await page.getByRole("navigation", { name: "Điều hướng chính" }).getByRole("link", { name: "Quy trình", exact: true }).click();
  await page.getByText("Mẫu", { exact: true }).first().click(); await page.waitForTimeout(1000);
  await page.getByRole("table", { name: "Quy trình" }).getByRole("row").filter({ hasText: "fixbug-apply" }).first().getByRole("link").first().click();
  await page.getByRole("button", { name: "Chép mẫu" }).first().click(); await page.waitForTimeout(2500);
  await snap(page, "03-copy-ok", true);
  const pn = page.getByRole("complementary", { name: "Chi tiết giai đoạn" });
  await page.getByRole("button", { name: /^Giai đoạn \d+: Tự sửa mã/ }).first().click();
  await snap(page, "03b-editor-autofix", true);
  console.log("url", page.url());
});
save("result-r2-copy2"); await browser.close();
