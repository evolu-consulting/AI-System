// CR-180 · «kiểm mobile» chặn tái phát cho Cộng đồng: Bảng tin, Hồ sơ, Yêu cầu tham gia, Báo cáo vi phạm ở 390×844 đạt 4 luật
// (R1 tràn ngang · R2 vùng bấm ≥ 44 · R3 chữ ≥ 12 · R4 nút trợ lý không che nút bấm lúc mở trang). Hàm đo + ngoại lệ: `_kit/mobile-rules.ts`.
// Adapter mock (persona mặc định = Admin). Không sleep.
import { test } from "@playwright/test";
import { expectMobileRules, MOBILE_USE, settle } from "../_kit/mobile-rules";

test.use(MOBILE_USE);

const SCREENS = [
  { name: "Bảng tin", path: "/community" },
  { name: "Hồ sơ", path: "/community/me" },
  { name: "Yêu cầu tham gia", path: "/community/requests" },
  { name: "Báo cáo vi phạm", path: "/community/reports" },
];

for (const s of SCREENS) {
  test.describe(`mobile · ${s.name}`, () => {
    test(`${s.name}: 4 luật mobile ở 390 px`, async ({ page }) => {
      await page.addInitScript(() => {
        try {
          localStorage.setItem("ai.locale", "vi");
          localStorage.setItem("assistant:open", "0");
        } catch {
          /* storage bị chặn */
        }
      });
      await page.goto(s.path);
      await settle(page);
      await expectMobileRules(page, `${s.name} (vừa mở)`);
    });
  });
}
