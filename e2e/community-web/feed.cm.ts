// CR-102 · C5 · e2e luồng chính của community-web với adapter mock (persona switcher chỉ có ở mock).
import { expect, test } from "@playwright/test";

const as = async (page: import("@playwright/test").Page, id: string) => {
  await page.getByLabel("Chọn nhân vật").selectOption(id);
};

test("chủ quản: đăng Cần bán, sửa (đã sửa), lưu trữ, xoá có xác nhận", async ({ page }) => {
  await page.goto("/#/feed");
  await expect(page.getByText("Sổ Hợp Tác").first()).toBeVisible();
  await page.getByLabel("Hàng hoá", { exact: true }).fill("Keo dán thử");
  await page.getByLabel("Số lượng").fill("10 thùng");
  await page.getByRole("button", { name: "Đăng bài" }).click();
  const card = page.getByTestId("post").filter({ hasText: "Keo dán thử" }).first();
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Tuỳ chọn bài đăng" }).click();
  await page.getByRole("menuitem", { name: "Sửa bài" }).click();
  await card.getByLabel("Sửa nội dung").fill("Nội dung đã chỉnh");
  await card.getByRole("button", { name: "Lưu thay đổi" }).click();
  await expect(card.getByText("đã sửa")).toBeVisible();
  await card.getByRole("button", { name: "Tuỳ chọn bài đăng" }).click();
  await page.getByRole("menuitem", { name: "Xoá bài" }).click();
  await expect(card.getByText("Xoá vĩnh viễn bài đăng này?")).toBeVisible();
  await card.getByRole("button", { name: "Xoá", exact: true }).click();
  await expect(page.getByText("Keo dán thử")).toHaveCount(0);
});

test("đối tác: bài của NCC bị che liên hệ, không có Lưu báo giá, không chatbot, ghi chú chỉ chủ quản", async ({
  page,
}) => {
  await page.goto("/#/feed");
  await as(page, "tp");
  const mine = page.locator('[data-post-id="p5"]');
  await expect(mine).toContainText("[SỐ ĐIỆN THOẠI]");
  await expect(mine).not.toContainText("0903");
  await expect(page.getByText("Lưu báo giá")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Mở trợ lý giá" })).toHaveCount(0);
  await expect(page.getByTestId("partner-note")).toHaveText("Chỉ chủ quản thấy bài này");
  await expect(page.getByTestId("post").filter({ hasText: "Chữ ký số HSM" })).toHaveCount(0); // audience chỉ người mua
});

test("chủ quản: luồng theo từng công ty + audience preview + nút Lưu báo giá bật và mở form (C7b)", async ({
  page,
}) => {
  await page.goto("/#/feed");
  await page.getByRole("button", { name: "Chọn người xem" }).click();
  await page.getByRole("button", { name: "Chỉ nhà cung cấp" }).click();
  await expect(page.getByTestId("audience-preview")).toContainText("Sẽ hiện với 3 công ty");
  const post = page.locator('[data-post-id="p1"]');
  await post.getByRole("button", { name: /Bình luận/ }).click();
  await expect(post.getByRole("tab", { name: /Hưng Thịnh/ })).toBeVisible();
  await expect(post.getByRole("tab", { name: /ABC/ })).toBeVisible();
  const tp = page.locator('[data-post-id="p5"]');
  const saveBtn = tp.getByRole("button", { name: /Lưu báo giá/ });
  await expect(saveBtn).toBeEnabled(); // C7b: chủ quản được lưu báo giá của NCC
  await saveBtn.click();
  await expect(tp.getByTestId("quote-form")).toBeVisible();
});

test("thông báo, hồ sơ, cài đặt màu chủ đạo", async ({ page }) => {
  await page.goto("/#/feed");
  await page.locator('button.iconbtn[aria-label="Thông báo"]').click(); // chuông; chip lọc "Thông báo" cùng tên nên không dùng getByRole
  await expect(page.getByRole("dialog", { name: "Thông báo" })).toBeVisible();
  await page.getByRole("button", { name: "Đánh dấu đã đọc" }).click();
  await page.getByRole("button", { name: "Cài đặt" }).first().click();
  await page.getByRole("button", { name: "Giao diện" }).click();
  await page.getByRole("button", { name: "Cam" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-accent", "orange");
  await page.getByRole("button", { name: /Hồ sơ/ }).click();
  await expect(page.getByTestId("sht-link")).toBeVisible();
});
