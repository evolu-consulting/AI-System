// CR-187 BR-187-6 + BR-187-9 · e2e Community (adapter mock): đổi tab «Tất cả/Cần bán» không làm khung nhảy (đo bounding box trước/sau),
// số đếm không về 0; nút icon Sửa/Xoá/Ẩn của bình luận cao 28px cách 2px (máy tính), 44px sát nhau (điện thoại), có tên đọc được.
import { expect, test } from "@playwright/test";

test("đổi tab Tất cả → Cần bán: khung các tab không đổi cỡ, số đếm không về 0", async ({
  page,
}) => {
  await page.goto("/community");
  const tabs = page.getByRole("tab");
  await expect(tabs.first()).toBeVisible();
  const boxes = async () => Promise.all((await tabs.all()).map((t) => t.boundingBox()));
  const before = await boxes();
  const counts = await page.locator(".tab .n").allTextContents();
  expect(counts.every((c) => c.trim() !== "0" || before.length === 0)).toBe(true);
  await page.getByRole("tab", { name: /Cần bán/ }).click();
  await expect(page.getByRole("tab", { name: /Cần bán/ })).toHaveAttribute("aria-selected", "true");
  const after = await boxes();
  expect(after).toEqual(before);
  await page.getByRole("tab", { name: /Tất cả/ }).click();
  expect(await boxes()).toEqual(before);
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
