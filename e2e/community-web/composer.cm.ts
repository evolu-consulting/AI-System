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
  const chip = composer(page).getByTestId("draft-file").filter({ hasText: "bao-gia.pdf" });
  await expect(chip).toBeVisible();
  await expect(chip).toContainText("2 KB");
  await page.getByLabel("Hàng hoá", { exact: true }).fill("Keo kèm PDF");
  await page.getByLabel("Số lượng").fill("3 thùng");
  await page.getByRole("button", { name: "Đăng bài" }).click();
  const posted = page.getByTestId("post").filter({ hasText: "Keo kèm PDF" }).first();
  await expect(posted).toBeVisible();
  const card = posted.getByTestId("file-card");
  await expect(card).toContainText("bao-gia.pdf");
  await expect(card.getByRole("button", { name: "Tải về bao-gia.pdf" })).toBeVisible();
  await expect(card.getByRole("button", { name: "Xem" })).toBeVisible();
});

// CR-172 · ô đăng bài không có đệm ngang riêng: mép trái/phải thẳng hàng với thanh tab và thẻ bài cùng cột.
test("CR172 · ô đăng bài thẳng mép trái/phải với thanh tab của bảng tin", async ({ page }) => {
  await page.goto("/community");
  const c = await composer(page).boundingBox();
  const bar = await page.locator(".feedbar").boundingBox();
  if (!c || !bar) throw new Error("không có khung");
  expect(Math.abs(c.x - bar.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(c.x + c.width - (bar.x + bar.width))).toBeLessThanOrEqual(1);
});

// CR-172 · trang không tìm thấy: khối căn giữa ngang + dọc, phủ rộng 100% vùng nội dung.
test("CR172 · trang lạ: khối «không tìm thấy» căn giữa ngang và dọc vùng nội dung", async ({
  page,
}) => {
  await page.goto("/khong-co-trang-nay");
  const box = page.getByTestId("not-found-page");
  await expect(box).toBeVisible();
  const b = await box.boundingBox();
  const vp = page.viewportSize();
  if (!b || !vp) throw new Error("không có khung");
  expect(b.width).toBeGreaterThan(vp.width * 0.5); // phủ rộng vùng nội dung, không co về trái
  const title = await box.locator("h1").boundingBox();
  if (!title) throw new Error("không có tiêu đề");
  expect(Math.abs(title.x + title.width / 2 - (b.x + b.width / 2))).toBeLessThanOrEqual(2);
  expect(title.y).toBeGreaterThan(b.y + b.height * 0.2); // không dồn lên đầu
  expect(title.y + title.height).toBeLessThan(b.y + b.height * 0.8);
});
