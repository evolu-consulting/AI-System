// CR-175 · Dialog có thanh cuộn RIÊNG: cao tối đa ~90vh, tiêu đề + hàng nút đứng yên trong khung nhìn, chỉ thân cuộn, nền bị khoá cuộn.
// Màn thấp (300px) làm hộp «Thêm sản phẩm» dài hơn khung nhìn. Backend giả `page.route`.
import { expect, type Page, test } from "@playwright/test";
import { installV2f } from "./v2f-support";

test.skip(process.env.CW_MODE === "ref", "chỉ kiểm hành vi contracts-web");

async function open(page: Page) {
  await installV2f(page);
  await page.route("**/pack/contracts/business/products?*", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [],
        total: 0,
        counts: { all: 0, service: 0, goods: 0, referral: 0 },
      }),
    }),
  );
  await page.setViewportSize({ width: 1024, height: 300 });
  await page.goto("/contracts/products");
  await page.getByTestId("gd1-add-product").click();
}

test("CR175 · hộp dài: thân cuộn riêng, tiêu đề + nút Lưu vẫn trong khung nhìn, nền khoá cuộn", async ({
  page,
}) => {
  await open(page);
  const dlg = page.getByRole("dialog", { name: "Thêm sản phẩm" });
  await expect(dlg).toBeVisible();
  const body = dlg.locator('[data-slot="dialog-body"]');
  const m = await body.evaluate((el) => ({
    sh: el.scrollHeight,
    ch: el.clientHeight,
    oy: getComputedStyle(el).overflowY,
  }));
  expect(m.oy).toBe("auto");
  expect(m.sh).toBeGreaterThan(m.ch);
  const vh = page.viewportSize()?.height ?? 0;
  for (const loc of [
    dlg,
    dlg.getByRole("heading", { name: "Thêm sản phẩm" }),
    dlg.getByRole("button", { name: "Lưu sản phẩm" }),
  ]) {
    const b = await loc.boundingBox();
    expect(b).not.toBeNull();
    expect(b?.y ?? -1).toBeGreaterThanOrEqual(0);
    expect((b?.y ?? 0) + (b?.height ?? 0)).toBeLessThanOrEqual(vh);
  }
  expect((await dlg.boundingBox())?.height ?? 0).toBeLessThanOrEqual(vh * 0.9 + 1);
  await expect(page.locator("body")).toHaveAttribute("data-scroll-locked", /.+/);
  // cuộn thân ⇒ nút ở chân vẫn thấy + bấm được; Header không trôi đi
  await body.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await expect(dlg.getByRole("button", { name: "Lưu sản phẩm" })).toBeInViewport();
  await expect(dlg.getByRole("heading", { name: "Thêm sản phẩm" })).toBeInViewport();
  await page.keyboard.press("Escape");
  await expect(dlg).toBeHidden();
});
