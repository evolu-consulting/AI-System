// CR-191 · trang Đối tác trên điện thoại: «Tìm công ty» là thao tác chính ⇒ nút hiện sẵn ở đầu trang (icon + chữ, cao ≥ 44 px), không giấu sau «⋯».
// Backend giả `page.route` như cr187-discover.cw.ts; chạy cuối đợt.
import { expect, type Route, test } from "@playwright/test";
import { asHub } from "./dataset";
import { installV2f } from "./v2f-support";

test.skip(process.env.CW_MODE === "ref", "chỉ kiểm hành vi contracts-web");
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

const json = (r: Route, status: number, body: unknown) =>
  r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

test("điện thoại: nút «Tìm công ty» hiện sẵn ở đầu trang, bấm mở hộp tìm; không có «⋯» thừa", async ({
  page,
}) => {
  await installV2f(page, { role: "editor" });
  await page.route("**/auth/refresh", (r) => json(r, 200, asHub("editor").grant));
  await page.route("**/pack/contracts/partners/page*", (r) =>
    json(r, 200, { items: [], total: 0 }),
  );
  await page.goto("/contracts/partners");
  const find = page.getByRole("button", { name: "Tìm công ty" });
  await expect(find).toBeVisible();
  const box = await find.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  await expect(page.getByRole("button", { name: "Thêm thao tác" })).toHaveCount(0);
  await find.click();
  await expect(page.getByRole("dialog", { name: "Tìm công ty để kết nối" })).toBeVisible();
});
