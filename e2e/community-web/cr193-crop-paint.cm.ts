// CR-193 (cr193-crop-fix) · hộp cắt ảnh (CR-192) phải VẼ ảnh ngay khi mở, không đợi người dùng kéo/phóng.
// Lỗi gốc: canvas nằm trong Portal của Radix Dialog (gắn sau lần render đầu) mà hiệu ứng vẽ chỉ chạy theo lần render của ImageCropDialog ⇒ lần đầu `ref` còn null ⇒ khung trống.
// (e2e C1 trong cr192-crop.cs.ts đi qua thanh phóng nên không bắt được.)
import { expect, test } from "@playwright/test";

async function png(page: import("@playwright/test").Page, w: number, h: number) {
  const b64 = await page.evaluate(
    ([W, H]) => {
      const cv = document.createElement("canvas");
      cv.width = W as number;
      cv.height = H as number;
      const g = cv.getContext("2d") as CanvasRenderingContext2D;
      g.fillStyle = "#c33";
      g.fillRect(0, 0, W as number, H as number);
      return cv.toDataURL("image/png").split(",")[1] as string;
    },
    [w, h],
  );
  return { name: "anh.png", mimeType: "image/png", buffer: Buffer.from(b64, "base64") };
}

/** Số điểm ảnh đã vẽ (alpha > 0) của canvas khung cắt. */
const painted = (page: import("@playwright/test").Page) =>
  page.getByTestId("crop-view").evaluate((el) => {
    const c = el as HTMLCanvasElement;
    const d = (c.getContext("2d") as CanvasRenderingContext2D).getImageData(
      0,
      0,
      c.width,
      c.height,
    ).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] !== 0) n++;
    return n;
  });

for (const [kind, id] of [
  ["đại diện", "me-avatar-edit-file"],
  ["bìa", "me-cover-edit-file"],
] as const) {
  test(`CR193 · hộp cắt ${kind} vẽ ảnh ngay khi mở (chưa kéo/phóng)`, async ({ page }) => {
    await page.goto("/community/me");
    await expect(page.getByTestId("me-page")).toBeVisible();
    await page.getByTestId(id).setInputFiles(await png(page, 1600, 1000));
    await expect(page.getByTestId("crop-view")).toBeVisible();
    await expect.poll(() => painted(page), { timeout: 5_000 }).toBeGreaterThan(1000);
  });
}
