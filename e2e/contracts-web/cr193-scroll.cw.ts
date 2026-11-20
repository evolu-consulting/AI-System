// CR-193 BR-193-7 · chuyển trang ⇒ về đầu (vùng cuộn chính của Shell); Back ⇒ về đúng chỗ đã đọc. Backend giả `page.route`; chạy cuối đợt.
import { expect, type Page, type Route, test } from "@playwright/test";
import { asHub } from "./dataset";
import { installV2f } from "./v2f-support";

test.skip(process.env.CW_MODE === "ref", "chỉ kiểm hành vi contracts-web");
test.use({ viewport: { width: 1280, height: 720 } }); // ≥ md: khung board tự cuộn

const json = (r: Route, status: number, body: unknown) =>
  r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

// Vùng cuộn chính: `main` (trang thường) hoặc khung `board` bên trong (danh sách/đối tác/sản phẩm từ md) — lấy cái đang có, ưu tiên board.
const MAIN =
  '[data-scroll-restoration-id="main-scroll-board"], [data-scroll-restoration-id="main-scroll"]';
const top = (page: Page) =>
  page.evaluate((s) => {
    const all = [...document.querySelectorAll(s)];
    return (
      (
        all.find((e) => e.getAttribute("data-scroll-restoration-id") === "main-scroll-board") ??
        all[0]
      )?.scrollTop ?? -1
    );
  }, MAIN);

test("chuyển trang về đầu, Back khôi phục vị trí đã cuộn", async ({ page }) => {
  await installV2f(page, { role: "editor" });
  await page.route("**/auth/refresh", (r) => json(r, 200, asHub("editor").grant));
  await page.route("**/pack/contracts/partners/page*", (r) =>
    json(r, 200, { items: [], total: 0 }),
  );
  await page.goto("/contracts/partners");
  await page.locator('[data-scroll-restoration-id="main-scroll-board"]').evaluate((el) => {
    const pad = document.createElement("div");
    pad.style.cssText = "height:4000px;flex:none"; // flex:none — khung board là cột flex, đệm rỗng sẽ bị co về 0
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
  await page.locator('[data-scroll-restoration-id="main-scroll-board"]').evaluate((el) => {
    if (el.scrollHeight < 3000) {
      const pad = document.createElement("div");
      pad.style.cssText = "height:4000px;flex:none"; // flex:none — khung board là cột flex, đệm rỗng sẽ bị co về 0
      el.appendChild(pad);
    }
  });
  // Vị trí được router khôi phục khi trang đã dựng; nội dung đệm thêm lại ⇒ cho phép sai số.
  expect(Math.abs((await top(page)) - before)).toBeLessThan(5);
});
