// CR-192 · HÀNH TRÌNH THẬT trên stack community-web (chỉ nhận `*.cs.ts`). VIẾT, CHƯA CHẠY (điều phối chạy cuối đợt).
// Chọn ảnh đại diện/ảnh bìa ⇒ hộp cắt (kéo, phóng 1–3×, đại diện tròn / bìa 3:1) ⇒ Lưu ⇒ ảnh hiện; bố cục hồ sơ KHÔNG đổi (so khung bao);
// ảnh khổng lồ (6000×4000) không bị từ chối; chưa có bìa ⇒ dải màu chuyển; không còn «Dùng ảnh mẫu».
//  C1 · Đại diện: hộp cắt tròn, kéo + phóng, Lưu ⇒ ảnh 400×400 ≤ 150 KB; khung bao avatar/bìa/nút bút trước = sau.
//  C2 · Bìa: hộp cắt 3:1 với ảnh 6000×4000 ⇒ Lưu ⇒ ảnh 1200×400 ≤ 400 KB; huỷ ⇒ không đổi gì.
import { expect, test } from "@playwright/test";
import { openAs } from "./_stack";

test.describe.configure({ mode: "serial" });

/** Dựng ảnh PNG `w×h` có hoạ tiết trong trình duyệt (không cần tệp mẫu) ⇒ buffer cho setInputFiles. */
async function bigImage(page: import("@playwright/test").Page, w: number, h: number) {
  const b64 = await page.evaluate(
    ([W, H]) => {
      const cv = document.createElement("canvas");
      cv.width = W as number;
      cv.height = H as number;
      const g = cv.getContext("2d") as CanvasRenderingContext2D;
      for (let i = 0; i < 60; i++) {
        g.fillStyle = `hsl(${(i * 37) % 360} 70% 50%)`;
        g.fillRect(((i * 97) % W) as number, ((i * 53) % H) as number, 400, 300);
      }
      return cv.toDataURL("image/png").split(",")[1] as string;
    },
    [w, h],
  );
  return { name: "lon.png", mimeType: "image/png", buffer: Buffer.from(b64, "base64") };
}

/** Khung bao theo TRANG (cộng cuộn): nếu trình duyệt cuộn thêm lúc đóng hộp thì vị trí trên trang vẫn đúng, chỉ dịch thật mới đỏ. */
const box = async (page: import("@playwright/test").Page, id: string) => {
  const r = (await page.getByTestId(id).first().boundingBox()) as {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  const sc = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
  return { ...r, x: r.x + sc.x, y: r.y + sc.y };
};

test("C1 · đổi ảnh đại diện qua hộp cắt, bố cục hồ sơ không đổi", async ({ browser }) => {
  const { page } = await openAs(browser, "host");
  await page.goto("/community/me");
  await expect(page.getByTestId("me-page")).toBeVisible();
  await page
    .getByTestId("me-avatar-edit-remove")
    .click({ timeout: 1_000 })
    .catch(() => undefined);
  await expect(page.getByRole("tab", { name: "Bài đăng của tôi" })).toBeVisible();
  await expect(page.getByTestId("me-avatar").first()).toBeVisible();
  await page.waitForLoadState("networkidle"); // đo «trước» khi hồ sơ đã dựng xong (nội dung nạp muộn làm nhích bố cục)
  const before = {
    avatar: await box(page, "me-avatar"),
    cover: await box(page, "me-cover-default"),
    pen: await box(page, "me-avatar-edit-change"),
  };
  await expect(page.getByText("Dùng ảnh mẫu")).toHaveCount(0);
  await page.getByTestId("me-avatar-edit-file").setInputFiles(await bigImage(page, 1600, 1200));
  await expect(page.getByTestId("crop-dialog")).toBeVisible();
  const view = page.getByTestId("crop-view");
  const vb = (await view.boundingBox()) as { x: number; y: number; width: number; height: number };
  expect(Math.abs(vb.width - vb.height)).toBeLessThan(2); // khung vuông (hiện tròn)
  await page.getByTestId("crop-zoom").fill("2");
  await page.mouse.move(vb.x + vb.width / 2, vb.y + vb.height / 2);
  await page.mouse.down();
  await page.mouse.move(vb.x + vb.width / 2 + 40, vb.y + vb.height / 2 + 20);
  await page.mouse.up();
  await page.getByTestId("crop-save").click();
  const img = page.locator('img[data-testid="me-avatar"]');
  await expect(img).toBeVisible();
  // ảnh hiện TRƯỚC khi hộp cắt đóng (lưu xong mới đóng); hộp còn mở thì Radix khoá cuộn ⇒ thanh cuộn biến mất, nội dung nhích ~18px.
  // Chỉ đo bố cục khi hộp đã đóng hẳn.
  await expect(page.getByTestId("crop-dialog")).toHaveCount(0);
  const src = (await img.getAttribute("src")) as string;
  expect(src.startsWith("data:image/")).toBe(true);
  expect(Math.floor((src.split(",")[1] as string).length * 0.75)).toBeLessThanOrEqual(153_600);
  const size = await img.evaluate((e) => [
    (e as HTMLImageElement).naturalWidth,
    (e as HTMLImageElement).naturalHeight,
  ]);
  expect(size).toEqual([400, 400]);
  // giao diện giữ nguyên: avatar, bìa, nút bút đứng yên, đúng kích thước
  for (const [k, id] of [
    ["avatar", "me-avatar"],
    ["pen", "me-avatar-edit-change"],
  ] as const) {
    const a = await box(page, id);
    // nút bút: khi đã có ảnh, nút «Gỡ ảnh» hiện cạnh bút (CR-156) và cặp nút căn giữa ⇒ bút nhích ngang 18 px theo thiết kế; chỉ đo y + kích thước
    if (k === "avatar") expect(Math.abs(a.x - before[k].x)).toBeLessThan(1.5);
    expect(Math.abs(a.y - before[k].y)).toBeLessThan(1.5);
    expect(Math.abs(a.width - before[k].width)).toBeLessThan(1.5);
    expect(Math.abs(a.height - before[k].height)).toBeLessThan(1.5);
  }
  const cover = await box(page, "me-cover-default");
  expect(Math.abs(cover.height - before.cover.height)).toBeLessThan(1.5);
  await page.getByTestId("me-avatar-edit-remove").click();
});

test("C2 · ảnh bìa 6000×4000: hộp cắt 3:1, ra 1200×400, huỷ không đổi", async ({ browser }) => {
  const { page } = await openAs(browser, "host");
  await page.goto("/community/me");
  await expect(page.getByTestId("me-cover-default")).toBeVisible(); // dải màu chuyển, không chữ
  await expect(page.getByTestId("me-cover-default")).toHaveText("");
  const big = await bigImage(page, 6000, 4000);
  await page.getByTestId("me-cover-edit-file").setInputFiles(big);
  const vb = (await page.getByTestId("crop-view").boundingBox()) as {
    width: number;
    height: number;
  };
  expect(Math.abs(vb.width / vb.height - 3)).toBeLessThan(0.05);
  await page.getByTestId("crop-cancel").click();
  await expect(page.getByTestId("me-cover-default")).toBeVisible();
  await page.getByTestId("me-cover-edit-file").setInputFiles(big);
  await page.getByTestId("crop-save").click();
  const img = page.getByTestId("me-cover");
  await expect(img).toBeVisible();
  const src = (await img.getAttribute("src")) as string;
  expect(Math.floor((src.split(",")[1] as string).length * 0.75)).toBeLessThanOrEqual(400 * 1024);
  const size = await img.evaluate((e) => [
    (e as HTMLImageElement).naturalWidth,
    (e as HTMLImageElement).naturalHeight,
  ]);
  expect(size).toEqual([1200, 400]);
  await page.getByTestId("me-cover-edit-remove").click();
  await expect(page.getByTestId("me-cover-default")).toBeVisible();
});

// C3 (ghi chú) · Cài đặt › Công ty (app Hợp đồng): ô «Tải ảnh bìa lên» (`cover-file`) mở cùng hộp cắt 3:1 (`crop-dialog`); «Lưu ảnh» ⇒ xem trước
// (`cover-preview`) hiện ảnh 1200×400; chưa có bìa ⇒ dải màu chuyển. Chạy ở stack hợp đồng (chưa có `*.cs.ts` cho trang này).
