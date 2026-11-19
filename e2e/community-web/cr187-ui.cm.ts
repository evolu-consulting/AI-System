// CR-187 BR-187-6 + BR-187-9 · e2e Community (adapter mock): đổi lọc loại bài không làm khung nhảy (đo bounding box trước/sau); nút icon Sửa/Xoá/Ẩn của bình luận cao 28px cách 2px (máy tính), 44px sát nhau (điện thoại), có tên đọc được.
import { expect, test } from "@playwright/test";

test("đổi lọc loại bài: cột bảng tin không đổi cỡ/vị trí (CR-191: lọc nằm trong sheet, không còn hàng tab)", async ({
  page,
}) => {
  await page.goto("/community");
  const col = page.locator(".feedbody");
  await expect(page.getByTestId("post").first()).toBeVisible();
  const before = await col.boundingBox();
  await page.getByTestId("feed-filter-btn").click();
  await page.getByTestId("filter-type-sell").click();
  await page.getByRole("button", { name: "Xong" }).click();
  await expect(page.getByTestId("feed-filter-n")).toHaveText("1");
  await expect(page.getByTestId("post").first()).toBeVisible();
  const after = await col.boundingBox();
  expect(after?.x).toBe(before?.x);
  expect(after?.width).toBe(before?.width);
});

test("nút icon của bình luận: 28px cách 2px trên máy tính", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/community");
  const acts = page
    .getByTestId("comment-acts")
    .filter({ has: page.locator(".iconact") })
    .first();
  const btns = acts.locator(".iconact");
  const n = await btns.count();
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    const b = await btns.nth(i).boundingBox();
    expect(b?.width).toBe(28);
    expect(b?.height).toBe(28);
    await expect(btns.nth(i)).toHaveAttribute("aria-label", /\S/);
    await expect(btns.nth(i)).toHaveText("");
  }
  if (n > 1) {
    const [a, b] = [await btns.nth(0).boundingBox(), await btns.nth(1).boundingBox()];
    expect(Math.round((b?.x ?? 0) - ((a?.x ?? 0) + (a?.width ?? 0)))).toBe(2);
  }
});

test("nút icon của bình luận: 44px sát nhau trên điện thoại", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/community");
  const btns = page.locator(".iconact");
  await expect(btns.first()).toBeVisible();
  const n = await btns.count();
  for (let i = 0; i < n; i++) {
    const b = await btns.nth(i).boundingBox();
    expect(b?.width).toBeGreaterThanOrEqual(44);
    expect(b?.height).toBeGreaterThanOrEqual(44);
  }
});
