// CR-193 BR-193-7 · chuyển trang ⇒ về đầu (vùng cuộn chính của Shell); Back ⇒ về đúng chỗ đã đọc. Backend giả `page.route`; chạy cuối đợt.
import { expect, type Page, type Route, test } from "@playwright/test";
import { asHub } from "./dataset";
import { installV2f } from "./v2f-support";

test.skip(process.env.CW_MODE === "ref", "chỉ kiểm hành vi contracts-web");

const json = (r: Route, status: number, body: unknown) =>
  r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

const MAIN = '[data-scroll-restoration-id="main-scroll"]';
const top = (page: Page) => page.evaluate((s) => document.querySelector(s)?.scrollTop ?? -1, MAIN);

test("chuyển trang về đầu, Back khôi phục vị trí đã cuộn", async ({ page }) => {
  await installV2f(page, { role: "editor" });
  await page.route("**/auth/refresh", (r) => json(r, 200, asHub("editor").grant));
  await page.route("**/pack/contracts/partners/page*", (r) =>
    json(r, 200, { items: [], total: 0 }),
  );
  await page.goto("/contracts/partners");
  await page.locator(MAIN).evaluate((el) => {
    const pad = document.createElement("div");
    pad.style.height = "4000px";
    el.appendChild(pad);
    el.scrollTop = 600;
  });
  await expect.poll(() => top(page)).toBeGreaterThan(400);
  const before = await top(page);
  await page
    .getByRole("navigation", { name: "Điều hướng chính" })
    .getByRole("link", { name: "Tổng quan" })
    .click();
  await expect(page).toHaveURL(/\/contracts$|\/overview$/);
  await expect.poll(() => top(page)).toBe(0);
  await page.goBack();
  await expect(page).toHaveURL(/\/contracts\/partners$/);
  await page.locator(MAIN).evaluate((el) => {
    if (el.scrollHeight < 3000) {
      const pad = document.createElement("div");
      pad.style.height = "4000px";
      el.appendChild(pad);
    }
  });
  // Vị trí được router khôi phục khi trang đã dựng; nội dung đệm thêm lại ⇒ cho phép sai số.
  expect(Math.abs((await top(page)) - before)).toBeLessThan(5);
});
