// CR-129 (f) · CR-164 · ảnh trong bài đăng (chế độ mẫu, không backend). VIẾT, CHƯA CHẠY.
// Lưới theo số ảnh: 1 lớn · 2 ngang · 3 (1 lớn + 2 nhỏ) · 4 lưới 2×2 · ≥5 ô cuối «+N»; bấm ⇒ phóng to, qua lại, Esc đóng.
// Lúc soạn: ảnh thu nhỏ, nút ✕ bỏ.
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

async function postImages(page: import("@playwright/test").Page, n: number, product: string) {
  await page.goto("/community");
  const composer = page.getByTestId("composer");
  await composer.getByRole("button", { name: "Cần bán", exact: true }).click();
  await page
    .getByTestId("attach-input")
    .setInputFiles(Array.from({ length: n }, (_, i) => png(i + 1)));
  await expect(composer.getByTestId("draft-image")).toHaveCount(n);
  await page.getByLabel("Hàng hoá", { exact: true }).fill(product);
  await page.getByLabel("Số lượng").fill("4 thùng");
  await page.getByRole("button", { name: "Đăng bài" }).click();
  return page.getByTestId("post").filter({ hasText: product }).first();
}

for (const [n, layout, tiles] of [
  [1, "one", 1],
  [2, "two", 2],
  [3, "three", 3],
  [4, "four", 4],
] as const) {
  test(`bài ${n} ảnh: bố cục ${layout}, ${tiles} ô, không «+N»`, async ({ page }) => {
    const post = await postImages(page, n, `Keo ${n} ảnh`);
    await expect(post.getByTestId("image-grid")).toHaveAttribute("data-layout", layout);
    await expect(post.getByTestId("post-image")).toHaveCount(tiles);
    await expect(post.getByTestId("image-more")).toHaveCount(0);
  });
}

test("bài 5 ảnh: 4 ô và «+1», bấm mở phóng to, qua lại, Esc đóng", async ({ page }) => {
  const post = await postImages(page, 5, "Keo năm ảnh");
  await expect(post.getByTestId("post-image")).toHaveCount(4);
  await expect(post.getByTestId("image-more")).toHaveText("+1");
  await post.getByTestId("post-image").first().click();
  const viewer = page.getByTestId("image-viewer");
  await expect(viewer).toBeVisible();
  await expect(viewer).toContainText("1 / 5");
  await viewer.getByRole("button", { name: "Ảnh sau" }).click();
  await expect(viewer).toContainText("2 / 5");
  await page.keyboard.press("ArrowLeft");
  await expect(viewer).toContainText("1 / 5");
  await expect(viewer.getByRole("button", { name: "Tải về" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);
});

test("lúc soạn: bấm ✕ bỏ một ảnh thu nhỏ", async ({ page }) => {
  await page.goto("/community");
  const composer = page.getByTestId("composer");
  await composer.getByRole("button", { name: "Cần bán", exact: true }).click();
  await page.getByTestId("attach-input").setInputFiles([png(1), png(2)]);
  await expect(composer.getByTestId("draft-image")).toHaveCount(2);
  await composer.getByTestId("draft-remove").first().click();
  await expect(composer.getByTestId("draft-image")).toHaveCount(1);
});
