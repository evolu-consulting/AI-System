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

test("một nút Đính kèm thay Ảnh và Video: tải PDF lên, đăng bài và thấy thẻ tệp", async ({
  page,
}) => {
  await page.goto("/community");
  await composer(page).getByRole("button", { name: "Cần bán", exact: true }).click();
  await expect(composer(page).getByRole("button", { name: "Đính kèm" })).toBeVisible();
  await expect(composer(page).getByRole("button", { name: "Ảnh", exact: true })).toHaveCount(0);
  await expect(composer(page).getByRole("button", { name: "Video", exact: true })).toHaveCount(0);
  await page.getByTestId("attach-input").setInputFiles({
    name: "bao-gia.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.alloc(2048, 1),
  });
  const chip = composer(page).locator(".attach", { hasText: "bao-gia.pdf" });
  await expect(chip).toBeVisible();
  await expect(chip).toContainText("2 KB");
  await page.getByLabel("Hàng hoá", { exact: true }).fill("Keo kèm PDF");
  await page.getByLabel("Số lượng").fill("3 thùng");
  await page.getByRole("button", { name: "Đăng bài" }).click();
  const posted = page.getByTestId("post").filter({ hasText: "Keo kèm PDF" }).first();
  await expect(posted).toBeVisible();
  const card = posted.getByTestId("file-card");
  await expect(card).toContainText("bao-gia.pdf");
  await expect(card).toContainText("Tải về");
});
