// Kịch bản 1c — nguồn library trong khối Tự sửa mã ⇒ Lưu 422 PROCESS_REF_INVALID ⇒ alert ô Nguồn (seed SQL nguồn library)
import { launch, adminLogin, mkSnap, mkStep } from "./lib.mjs";
const OUT = "D:/AI/ai-system/docs/specs/P-c-autofix/evidence/2026-10-14/round2";
const { browser, page } = await launch(OUT);
const snap = mkSnap(OUT);
const { step, log, save } = mkStep(OUT, () => ({ A: page }), snap);
const pn = page.getByRole("complementary", { name: "Chi tiết giai đoạn" });
await step("A10", "thêm nguồn uat-lib (library) vào def, chọn ở khối Tự sửa mã ⇒ Lưu 422 ⇒ alert 'thuộc loại library'", async () => {
  await adminLogin(page, "julian.bui", "evolu");
  await page.getByRole("navigation", { name: "Điều hướng chính" }).getByRole("link", { name: "Quy trình", exact: true }).click();
  await page.getByRole("table", { name: "Quy trình" }).getByRole("row").filter({ hasText: "fixbug-apply" }).getByRole("link", { name: "Sửa lỗi tự áp (diff)" }).click();
  await page.getByRole("combobox", { name: /Thêm nguồn/ }).or(page.getByText("Thêm nguồn", { exact: true })).click();
  await snap(page, "10-A-add-source-menu");
  await page.getByRole("option", { name: /uat-lib/ }).or(page.getByRole("menuitem", { name: /uat-lib/ })).first().click();
  await pn.getByRole("combobox", { name: "Nguồn" }).click();
  await snap(page, "10b-A-source-options");
  await page.getByRole("option", { name: /uat-lib/ }).click();
  const put = page.waitForResponse((r) => r.request().method() === "PUT" && /process-defs/.test(r.url()));
  await page.getByRole("button", { name: "Lưu", exact: true }).click();
  const st = (await put).status();
  if (st !== 422) throw new Error("PUT " + st);
  await page.getByRole("alert").filter({ hasText: 'Nguồn "uat-lib" thuộc loại library, không sửa được.' }).first().waitFor();
  await snap(page, "10c-A-library-422");
  await pn.screenshot({ path: `${OUT}/10d-A-library-422-panel.png` });
});
await step("A11", "tải lại (bỏ thay đổi chưa lưu) ⇒ def trở lại nguồn repo", async () => {
  await page.reload();
  await pn.getByRole("combobox", { name: "Nguồn" }).waitFor();
  if (!(await pn.getByRole("combobox", { name: "Nguồn" }).innerText()).includes("repo")) throw new Error("nguồn không về repo");
});
save("result-r2-library"); await browser.close();
