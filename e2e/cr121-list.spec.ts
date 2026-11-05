// CR-121 C-1b · danh sách "Hướng A": lọc bằng phễu (một control/nhóm), bấm hàng mở ngăn, Esc đóng, không tràn ở 375px.
import { expect, test } from "@playwright/test";
import { loginAdmin, openPage, resetFixture } from "./support/helpers";

test.describe.configure({ mode: "serial" });
test.beforeAll(() => {
  resetFixture();
});

test("CR-121 · /commands: phễu → chọn Tắt → chip + n / tổng; bỏ chip → đủ lại", async ({
  page,
}) => {
  await loginAdmin(page);
  await openPage(page, "/commands", "Commands");
  const total = page.getByText(/^\d+ \/ \d+$/);
  await expect(total).toBeVisible();
  await page.getByRole("button", { name: "Lọc" }).click();
  await page.getByRole("menuitemradio", { name: /^Tắt/ }).click();
  await expect(page.getByRole("button", { name: /Bỏ lọc Trạng thái: Tắt/ })).toBeVisible();
  await expect(total).toHaveText(/^2 \/ 5$/);
  await page.getByRole("button", { name: /Bỏ lọc Trạng thái: Tắt/ }).click();
  await expect(total).toHaveText(/^5 \/ 5$/);
});

test("CR-121 · /commands: bấm cả hàng mở ngăn có 'Mở trang chi tiết'; Esc đóng", async ({
  page,
}) => {
  await loginAdmin(page);
  await openPage(page, "/commands", "Commands");
  await page.getByRole("row", { name: /\/dich(?![\w-])/ }).click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("link", { name: "Mở trang chi tiết" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
});

test("CR-121 · /features: lọc không khớp → 'Không có tính năng khớp bộ lọc' + Bỏ lọc; ngăn đóng bằng nút Đóng", async ({
  page,
}) => {
  await loginAdmin(page);
  await openPage(page, "/features", "Features");
  await page.getByRole("searchbox").fill("zzz-khong-co");
  await expect(page.getByText("Không có tính năng khớp bộ lọc")).toBeVisible();
  await page.getByRole("button", { name: "Xoá bộ lọc" }).click();
  await page
    .getByRole("row", { name: /Mặc định/ })
    .first()
    .click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();
  await drawer.getByRole("button", { name: "Đóng" }).click();
  await expect(drawer).toHaveCount(0);
});

test("CR-121 · /apps ở 375px: ngăn không tràn ngang", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await loginAdmin(page);
  await page.goto("/apps");
  await page.getByRole("row").nth(1).click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();
  // chờ ngăn trượt xong (animation 500 ms) rồi mới đo: đo ngay lúc đang trượt thì x > 0
  await expect
    .poll(async () => {
      const box = await drawer.boundingBox();
      return !!box && box.x >= 0 && box.x + box.width <= 375;
    })
    .toBe(true);
});
