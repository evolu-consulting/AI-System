// CR-118 · spec §11.1 · e2e ô đăng bản tin (adapter mock): thu gọn/mở nhớ theo người dùng, nút "Đính kèm" gộp, tệp chưa hỗ trợ.
import { expect, test } from "@playwright/test";

const composer = (page: import("@playwright/test").Page) => page.getByTestId("composer");

test("ô đăng thu gọn và mở lại, trạng thái được nhớ sau khi tải lại", async ({ page }) => {
  await page.goto("/community");
  await expect(composer(page).getByRole("button", { name: /đang có hàng cần bán/ })).toBeVisible();
  await composer(page).getByRole("button", { name: "Cần bán", exact: true }).click();
  await expect(page.getByTestId("composer-collapse")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("composer-collapse")).toBeVisible(); // đã nhớ: mở
  await page.getByTestId("composer-collapse").click();
  await expect(composer(page).getByRole("button", { name: /đang có hàng cần bán/ })).toBeVisible();
  await page.reload();
  await expect(composer(page).getByRole("button", { name: /đang có hàng cần bán/ })).toBeVisible(); // đã nhớ: thu gọn
});

test("một nút Đính kèm thay Ảnh và Video: ảnh thành chip, PDF báo chưa hỗ trợ", async ({
  page,
}) => {
  await page.goto("/community");
  await composer(page).getByRole("button", { name: "Cần bán", exact: true }).click();
  await expect(composer(page).getByRole("button", { name: "Đính kèm" })).toBeVisible();
  await expect(composer(page).getByRole("button", { name: "Ảnh", exact: true })).toHaveCount(0);
  await expect(composer(page).getByRole("button", { name: "Video", exact: true })).toHaveCount(0);
  await page.getByTestId("attach-input").setInputFiles([
    { name: "anh1.png", mimeType: "image/png", buffer: Buffer.from("x") },
    { name: "bao-gia.pdf", mimeType: "application/pdf", buffer: Buffer.from("x") },
  ]);
  await expect(composer(page).locator(".attach", { hasText: "anh1.png" })).toBeVisible();
  await expect(composer(page).locator(".attach", { hasText: "bao-gia.pdf" })).toHaveCount(0);
  await expect(page.getByText("Chưa hỗ trợ tệp này")).toBeVisible();
});
