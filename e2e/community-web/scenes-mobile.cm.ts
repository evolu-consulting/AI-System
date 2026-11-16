// CR-180 · ảnh mẫu điện thoại 390 px của Bảng tin (so ảnh; baseline chụp SAU khi lát sửa trang xong — điều phối chụp:
// `CM_MODE=capture` ghi baseline, mặc định so và thiếu baseline ⇒ đỏ). Adapter mock, persona Admin.
import { expect, test } from "@playwright/test";
import { MOBILE_USE, settle } from "../_kit/mobile-rules";

test.use(MOBILE_USE);

test("CR-180 · bang-tin-mobile · ảnh 390 px khớp baseline", async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("ai.locale", "vi");
      localStorage.setItem("assistant:open", "0");
    } catch {
      /* storage bị chặn */
    }
  });
  await page.clock.setFixedTime(new Date("2026-10-18T09:00:00+07:00"));
  await page.goto("/community");
  await settle(page);
  await expect(page).toHaveScreenshot("bang-tin-mobile.png", {
    animations: "disabled",
    caret: "hide",
    threshold: 0.2,
    maxDiffPixelRatio: 0.005,
  });
});
