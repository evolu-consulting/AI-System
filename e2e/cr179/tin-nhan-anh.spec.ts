// CR-179 · ảnh trong tin KHÔNG được co về 0×0 (khung ảnh `width: 100%` trong bong bóng chat co theo nội dung ⇒ ảnh biến mất; sửa ở `AttachGallery.tsx`).
// A (nhân viên, người gửi) gửi 1 ảnh PNG; B (giám đốc, người nhận — khác người gửi) mở cuộc ⇒ ảnh có khung rộng ≥ 100, cao ≥ 75 và đã tải xong.
// Chạy qua `e2e/cr127/playwright.cr127.config.ts` (testMatch có thư mục này): `run-tests.ps1 -Step e2e -Filter cr127`.

import { envOf, expect, loginCw, SPEC_TENANT, U } from "../cr127/_cr127-kit";
import { test } from "../journey-approval/_test";

const E = envOf(SPEC_TENANT.j01);
const FROM = "E2E Nhân viên Kinh doanh";
const TAG = Date.now().toString(36);
const NAME = `anh-${TAG}.png`;
// PNG 1×1 hợp lệ (đủ để trình duyệt giải mã ⇒ naturalWidth > 0); khung hiển thị do kit quyết định, không phụ thuộc cỡ ảnh gốc
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
  "base64",
);

test("A gửi ảnh, B (người nhận) thấy ảnh hiện ra đủ cỡ trong tin", async ({ browser }) => {
  test.setTimeout(180_000);
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  await loginCw(a, E, U.employee);
  await loginCw(b, E, U.director);
  await b.goto("/contracts/messages");

  // A: Nhắn tin mới → chọn B → đính ảnh → gửi
  await a.goto("/contracts/messages");
  await a.getByRole("button", { name: "Nhắn tin mới" }).first().click();
  const dlg = a.getByTestId("new-conv-dialog");
  await dlg.getByRole("searchbox", { name: "Tìm đồng nghiệp" }).fill("giam");
  await dlg.getByRole("checkbox").first().check();
  await dlg.getByRole("button", { name: "Nhắn tin", exact: true }).click();
  await a
    .getByTestId("composer-file-input")
    .setInputFiles({ name: NAME, mimeType: "image/png", buffer: PNG });
  await a.getByRole("button", { name: "Gửi", exact: true }).click();
  await expect(a.getByTestId("msg-row").getByTestId("image-grid").last()).toBeVisible();

  // B (người nhận): mở cuộc của A ⇒ khung ảnh trong tin có cỡ thật và ảnh đã tải
  await b.getByTestId("conv-row").filter({ hasText: FROM }).click();
  const grid = b.getByTestId("msg-row").getByTestId("image-grid").last();
  await expect(grid).toBeVisible();
  const frame = grid.getByTestId("post-image");
  await expect(frame).toBeVisible();
  const box = await frame.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(100);
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(75);
  await expect
    .poll(() => frame.locator("img").evaluate((el) => (el as HTMLImageElement).naturalWidth), {
      timeout: 30_000,
    })
    .toBeGreaterThan(0);

  await ctxA.close();
  await ctxB.close();
});
