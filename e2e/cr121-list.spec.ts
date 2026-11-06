// CR-121 C-1b · danh sách "Hướng A": lọc bằng phễu (một control/nhóm), bấm hàng mở ngăn, Esc đóng, không tràn ở 375px.
import { expect, test } from "@playwright/test";
import { loginAdmin, openPage, resetFixture } from "./support/helpers";

test.describe.configure({ mode: "serial" });
test.beforeAll(() => {
  resetFixture();
});

test("CR-121 · c16 · /ai-tools (thay /commands): chip loại Lệnh → danh sách còn đúng n công cụ; bỏ chip → đủ lại", async ({
  page,
}) => {
  await loginAdmin(page);
  await openPage(page, "/ai-tools?kind=command", "Công cụ AI");
  const shown = page.getByText(/^\d+ trong \d+ công cụ$/);
  const chip = page.getByRole("button", { name: /^Lệnh\s*\d+$/ });
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  const n = Number(((await chip.textContent()) ?? "").replace(/\D/g, ""));
  expect(n).toBeGreaterThan(0);
  await expect(shown).toHaveText(new RegExp(`^${n} trong ${n} công cụ$`));
  await chip.click(); // bỏ chip Lệnh
  await expect(chip).toHaveAttribute("aria-pressed", "false");
  await expect(shown).not.toHaveText(new RegExp(`^${n} trong ${n} công cụ$`));
});

test("CR-121 · c16 · /ai-tools: bấm cả hàng lệnh mở ngăn có 'Mở trang lệnh'; Esc đóng", async ({
  page,
}) => {
  await loginAdmin(page);
  await openPage(page, "/ai-tools?kind=command", "Công cụ AI");
  await page.getByRole("row", { name: /(?<![\w-])dich(?![\w-])/ }).click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("link", { name: "Mở trang lệnh" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
});
test("CR-121 · /features: lọc không khớp → 'Không có tính năng khớp bộ lọc' + Bỏ lọc; ngăn đóng bằng nút Đóng", async ({
  page,
}) => {
  await loginAdmin(page);
  await page.goto("/features");
  await expect(page.getByRole("heading", { level: 1, name: "Features" })).toBeVisible();
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
