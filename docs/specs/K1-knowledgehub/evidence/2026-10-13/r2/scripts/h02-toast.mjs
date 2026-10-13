// H4b-1 Minor: toast (vừa xoay khoá) còn hiện khi mở Sheet Thêm secret + lỗi validate: toast không đè nút Huỷ/Lưu.
import { launch, studioLogin, mkSnap, mkStep, expect } from "./lib.mjs";
const OUT = process.argv[2];
for (const [name, vp] of [["desktop", { width: 1280, height: 800 }], ["mobile", { width: 390, height: 844 }]]) {
  const { browser, page } = await launch(OUT, vp);
  const snap = mkSnap(OUT);
  const { step, save } = mkStep(OUT, () => ({ A: page }), snap);
  await studioLogin(page);
  await step(`H02-${name}`, `Toast còn hiện khi Sheet mở không đè nút Huỷ/Lưu (${name})`, async () => {
    await page.goto("http://localhost:3200/studio/secrets");
    await page.getByRole("tablist", { name: "Loại secret" }).getByRole("tab", { name: "Khoá KnowledgeHub" }).click();
    const row = page.getByRole("table", { name: "Danh sách secret" }).getByRole("row").filter({ hasText: "kh-wrong" });
    // 1) xoay khoá → toast "Đã lưu"; 2) tạo thêm toast bằng xoay lần nữa; 3) mở Sheet Thêm với toast còn trên màn hình
    for (let k = 0; k < 2; k++) {
      await row.getByRole("button", { name: "Thay giá trị" }).click();
      const rd = page.getByRole("dialog").first();
      await rd.getByLabel("Giá trị", { exact: true }).fill(`sk-rot-${k}-12345678`);
      await rd.getByRole("button", { name: "Lưu" }).click();
      await expect(rd.getByRole("status").filter({ hasText: "Đã lưu" })).toBeVisible();
      await rd.getByRole("button", { name: "Đóng" }).click();
    }
    await page.getByRole("button", { name: "+ Thêm secret" }).first().click();
    const dlg = page.getByRole("dialog", { name: "Thêm secret" });
    await dlg.getByRole("button", { name: "Lưu" }).click();
    await page.waitForTimeout(400);
    await snap(page, `13-A-toast-with-sheet-${name}`);
    const toasts = page.getByRole("region", { name: "Notifications" }).locator("li");
    const n = await toasts.count();
    const bs = [await dlg.getByRole("button", { name: "Huỷ" }).boundingBox(), await dlg.getByRole("button", { name: "Lưu" }).boundingBox()];
    const overlaps = [];
    for (let i = 0; i < n; i++) {
      const tb = await toasts.nth(i).boundingBox(); if (!tb) continue;
      for (const b of bs) if (b && tb.x < b.x + b.width && tb.x + tb.width > b.x && tb.y < b.y + b.height && tb.y + tb.height > b.y) overlaps.push({ i, tb, b });
    }
    console.log(name, "toasts:", n, "overlaps:", JSON.stringify(overlaps));
    expect(n).toBeGreaterThan(0);
    expect(overlaps.length).toBe(0);
    await dlg.getByRole("button", { name: "Huỷ" }).click();
  });
  save(); await browser.close();
}
