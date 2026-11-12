// CR-129 (f) · ảnh trong bài đăng (chế độ mẫu, không backend). VIẾT, CHƯA CHẠY.
// Đăng bài kèm 4 ảnh ⇒ lưới 3 ô, ô cuối «+1»; bấm ảnh ⇒ hộp phóng to, qua lại, Esc đóng.
import { expect, test } from "@playwright/test";

const png = (n: number) => ({
  name: `anh-${n}.png`,
  mimeType: "image/png",
  // PNG 1×1
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
});

test("bài 4 ảnh: thấy 3 ô và «+1», bấm mở phóng to, Esc đóng", async ({ page }) => {
  await page.goto("/community");
  const composer = page.getByTestId("composer");
  await composer.getByRole("button", { name: "Cần bán", exact: true }).click();
  await page.getByTestId("attach-input").setInputFiles([1, 2, 3, 4].map(png));
  await page.getByLabel("Hàng hoá", { exact: true }).fill("Keo bốn ảnh");
  await page.getByLabel("Số lượng").fill("4 thùng");
  await page.getByRole("button", { name: "Đăng bài" }).click();
  const post = page.getByTestId("post").filter({ hasText: "Keo bốn ảnh" }).first();
  await expect(post.getByTestId("post-image")).toHaveCount(3);
  await expect(post.getByTestId("image-more")).toHaveText("+1");
  await post.getByTestId("post-image").first().click();
  const viewer = page.getByTestId("image-viewer");
  await expect(viewer).toBeVisible();
  await expect(viewer).toContainText("1 / 4");
  await viewer.getByRole("button", { name: "Ảnh sau" }).click();
  await expect(viewer).toContainText("2 / 4");
  await expect(viewer.getByRole("button", { name: "Tải về" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);
});
