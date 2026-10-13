// Vòng 2 · #3 chép mẫu khi tenant chưa có nguồn repo ⇒ toast VI; rồi tạo nguồn, chép lại.
import { launch, adminLogin, mkSnap, mkStep } from "./lib.mjs";
import { login } from "./api.mjs";
import { execFileSync } from "node:child_process";
const OUT = "D:/AI/ai-system/docs/specs/P-c-autofix/evidence/2026-10-14/round2";
const EV = "01a11c1d-ca4e-7000-b4eb-212defbb548f";
const { browser, page } = await launch(OUT); const snap = mkSnap(OUT);
const { step, save } = mkStep(OUT, () => ({ A: page }), snap);
const toTemplate = async () => {
  await page.getByRole("navigation", { name: "Điều hướng chính" }).getByRole("link", { name: "Quy trình", exact: true }).click();
  await page.waitForTimeout(1500);
};
await step("R01", "[julian.bui] chép mẫu fixbug-apply khi chưa có nguồn repo ⇒ toast VI có hướng dẫn", async () => {
  const p = await login("platform", "admin");
  const r = await fetch(`http://localhost:4000/admin/sources/repo?tenant_id=${EV}&version=1`, { method: "DELETE", headers: { authorization: "Bearer " + p } }); console.log("del src", r.status);
  await adminLogin(page, "julian.bui", "evolu"); await toTemplate();
  await snap(page, "01-process-list");
  await page.getByRole("tab", { name: "Mẫu" }).or(page.getByText("Mẫu", { exact: true })).first().click(); await page.waitForTimeout(1000); await snap(page, "01b-templates");
  const row = page.getByRole("table", { name: "Quy trình" }).getByRole("row").filter({ hasText: "fixbug-apply" }).first();
  await row.getByRole("link").first().click(); await page.waitForTimeout(1500); await snap(page, "01c-template-view");
  await page.getByRole("button", { name: "Chép mẫu" }).first().click();
  await page.waitForTimeout(1200);
  await snap(page, "02-copy-toast-no-source");
  const t = await page.getByRole("status").or(page.getByRole("alert")).allInnerTexts(); console.log("toast:", JSON.stringify(t));
  if (/Source not found/.test(t.join(" "))) throw new Error("toast thô");
});
save("result-r2-copy"); await browser.close();
