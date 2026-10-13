// Minor 3 (project rỗng "— không ghi", hint ô Khoá) + Minor 5 (mobile 390: nút hành động trong viewport, badge không chồng chữ)
import { launch, studioLogin, mkSnap, mkStep, expect, KH } from "./lib.mjs";
const OUT = process.argv[2];
const { browser, page } = await launch(OUT, { width: 390, height: 844 });
const snap = mkSnap(OUT);
const { step, save } = mkStep(OUT, () => ({ A: page }), snap);
await studioLogin(page);
await page.goto("http://localhost:3200/studio/settings");
await expect(page.getByRole("heading", { name: "Kết nối KnowledgeHub" })).toBeVisible();
await step("M3", "Thêm kh-noproj (project rỗng) → hàng hiện '— không ghi'; hint dưới ô Khoá (mobile)", async () => {
  await page.getByRole("button", { name: "Thêm kết nối" }).first().click();
  const d = page.getByRole("dialog", { name: "Thêm kết nối" });
  await d.getByRole("textbox", { name: "Tên" }).fill("kh-noproj");
  await d.getByRole("textbox", { name: "Địa chỉ" }).fill("http://127.0.0.1:4030");
  await d.getByRole("combobox", { name: "Khoá" }).click();
  await page.getByRole("option", { name: "kh-main" }).click();
  await expect(d.getByText("Chọn secret KnowledgeHub đã lưu ở màn Secrets")).toBeVisible();
  await snap(page, "m-01-sheet-hint-mobile");
  await d.getByRole("button", { name: "Lưu" }).click();
  await expect(d.getByRole("status").filter({ hasText: "Đã lưu · v1" })).toBeVisible();
  await snap(page, "m-02-sheet-saved-v1-mobile");
  await d.getByRole("button", { name: "Đóng" }).click();
  const row = page.getByRole("table", { name: "Kết nối KnowledgeHub" }).getByRole("row").filter({ hasText: "kh-noproj" });
  await expect(row).toContainText("— không ghi");
});
await step("M5", "Mobile 390: nút Kiểm tra/Sửa/Xoá trong viewport, không tràn ngang trang, badge hub config không chồng chữ", async () => {
  const row = page.getByRole("table", { name: "Kết nối KnowledgeHub" }).getByRole("row").filter({ hasText: "kh-noproj" });
  for (const n of [/^Kiểm tra /, /^Sửa /, /^Xoá /]) {
    const b = await row.getByRole("button", { name: n }).boundingBox();
    expect(b && b.x >= 0 && b.x + b.width <= 390).toBe(true);
  }
  const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(ov).toBe(0);
  const badge = page.getByText(/hub config v\d+/).first();
  const bb = await badge.boundingBox();
  const sib = await page.evaluate(() => { const e = [...document.querySelectorAll("*")].find((x) => /^hub config v\d+/.test(x.textContent?.trim() ?? "") && x.children.length === 0); const r = e.getBoundingClientRect(); return { sw: e.scrollWidth, cw: e.clientWidth, right: r.right }; });
  console.log("badge", JSON.stringify(bb), JSON.stringify(sib));
  expect(sib.sw).toBeLessThanOrEqual(sib.cw + 1);
  await snap(page, "m-03-settings-mobile-actions", true);
  // xoá dọn
  await row.getByRole("button", { name: /^Xoá / }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Xoá" }).click();
  await expect(row).toHaveCount(0);
});
save(); await browser.close();
