// CR-147b · HÀNH TRÌNH THẬT (không mock) trên stack community-web (playwright.stack.config.ts, chỉ nhận `*.cs.ts`). VIẾT, CHƯA CHẠY.
// Người dùng tự đổi ảnh đại diện + ảnh bìa ở hồ sơ cá nhân `/community/me`, xoá avatar ⇒ về chữ cái đầu; chủ sở hữu đổi ảnh bìa công ty
// ngay ở trang công ty (cùng nguồn CR-138). Ảnh là PNG 1×1 dựng tại chỗ (đúng định dạng), tệp sai định dạng bị từ chối bằng nhãn nghiệp vụ.
//  P1 · /community/me: chưa có avatar ⇒ chữ cái đầu; chọn ảnh ⇒ hiện ảnh; tải lại trang ⇒ vẫn còn; «Xoá ảnh» ⇒ chữ cái đầu.
//  P2 · Đổi ảnh bìa cá nhân (icon bút, hiện khi hover) ⇒ hiện ảnh bìa; tải lại vẫn còn; tệp .gif ⇒ «Chỉ nhận ảnh JPG, PNG hoặc WebP», không lưu.
//  P3 · Trang công ty: chủ sở hữu thấy icon bút đổi ảnh bìa ⇒ đổi ⇒ ảnh bìa công ty hiện; xoá ⇒ về nền màu chủ đạo.
import { expect, test } from "@playwright/test";
import { openAs } from "./_stack";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
  "base64",
);
const img = { name: "anh.png", mimeType: "image/png", buffer: PNG };

test.describe.configure({ mode: "serial" });

test("P1 · đổi + xoá ảnh đại diện ở hồ sơ cá nhân", async ({ browser }) => {
  // PersonAvatar: chữ cái đầu = <span role="img">, ảnh = <img>; cùng data-testid «me-avatar»
  const { page } = await openAs(browser, "host");
  await page.goto("/community/me");
  await expect(page.getByTestId("me-page")).toBeVisible();
  await page
    .getByTestId("me-avatar-edit-remove")
    .click({ timeout: 1_000 })
    .catch(() => undefined);
  await expect(page.locator('span[data-testid="me-avatar"]')).toBeVisible();
  await page.getByTestId("me-avatar-edit-file").setInputFiles(img);
  await expect(page.locator('img[data-testid="me-avatar"]')).toBeVisible();
  await page.reload();
  await expect(page.locator('img[data-testid="me-avatar"]')).toBeVisible();
  await page.getByTestId("me-avatar-edit-remove").click();
  await expect(page.locator('span[data-testid="me-avatar"]')).toBeVisible();
});

test("P2 · ảnh bìa cá nhân: đổi, tải lại còn, tệp sai định dạng bị từ chối", async ({
  browser,
}) => {
  const { page } = await openAs(browser, "host");
  await page.goto("/community/me");
  await expect(page.getByTestId("me-cover-default")).toBeVisible();
  // CR-156 · nút đổi ảnh là icon bút (nhãn aria), chỉ hiện khi rê chuột lên ảnh bìa
  const change = page.getByTestId("me-cover-edit-change");
  await expect(change).toHaveAttribute("aria-label", "Đổi ảnh bìa");
  await expect(change).toHaveCSS("opacity", "0");
  await page.getByTestId("me-cover-default").hover();
  await expect(change).toHaveCSS("opacity", "1");
  await page
    .getByTestId("me-cover-edit-file")
    .setInputFiles({ name: "a.gif", mimeType: "image/gif", buffer: PNG });
  await expect(page.getByTestId("me-cover-edit-err")).toHaveText("Chỉ nhận ảnh JPG, PNG hoặc WebP");
  await expect(page.getByTestId("me-cover-default")).toBeVisible();
  await page.getByTestId("me-cover-edit-file").setInputFiles(img);
  await expect(page.getByTestId("me-cover")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("me-cover")).toBeVisible();
  await page.getByTestId("me-cover-edit-remove").click();
  await expect(page.getByTestId("me-cover-default")).toBeVisible();
});

test("P3 · chủ sở hữu đổi ảnh bìa công ty ngay ở trang công ty", async ({ browser }) => {
  const { page } = await openAs(browser, "host");
  await page.goto("/community/me");
  await page.getByRole("link", { name: "Xem trang công ty" }).click();
  await expect(page.getByTestId("profile-page")).toBeVisible();
  await page.getByTestId("company-cover-edit-file").setInputFiles(img);
  await expect(page.getByTestId("company-cover")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("company-cover")).toBeVisible();
  await page.getByTestId("company-cover-edit-remove").click();
  await expect(page.getByTestId("company-cover-default")).toBeVisible();
});
