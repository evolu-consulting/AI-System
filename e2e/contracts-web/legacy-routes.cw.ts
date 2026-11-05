// CR-119 phần 2 · Luật 4b: SHT dưới `/contracts` — URL cũ ở gốc (bookmark, email duyệt, thông báo đã lưu, `?next=`) chuyển hướng client
// sang URL mới, giữ query/hash; URL mới mở trực tiếp. Backend giả `page.route`; không sleep.
import { expect, test } from "@playwright/test";
import { ACTIVE_ID } from "./dataset-v2f";
import { installV2f } from "./v2f-support";

test.skip(process.env.CW_MODE === "ref", "chỉ kiểm hành vi contracts-web");

const hops: [from: string, to: RegExp][] = [
  ["/overview", /\/contracts$/],
  ["/contracts?type=deal", /\/contracts\/list\?type=deal$/],
  ["/partners?party=mst%3A0101", /\/contracts\/partners\?party=mst%3A0101$/],
  ["/products?sp=p1", /\/contracts\/products\?sp=p1$/],
  ["/settings/members", /\/contracts\/settings\/members$/],
  ["/contracts/new?type=deal", /\/contracts\/c\/new\?type=deal$/],
  [`/contracts/${ACTIVE_ID}`, new RegExp(`/contracts/c/${ACTIVE_ID}$`)],
  [`/contracts/${ACTIVE_ID}?tab=log`, new RegExp(`/contracts/c/${ACTIVE_ID}\\?tab=log$`)],
];

test("URL cũ chuyển hướng sang /contracts/… (giữ query)", async ({ page }) => {
  await installV2f(page);
  for (const [from, to] of hops) {
    await page.goto(from);
    await expect(page).toHaveURL(to);
    await expect(page.getByRole("navigation", { name: "Điều hướng chính" })).toBeVisible();
  }
});

test("URL mới mở thẳng, không bị đổi; Tổng quan sáng ở gốc /contracts", async ({ page }) => {
  await installV2f(page);
  for (const path of [
    "/contracts",
    "/contracts/list",
    "/contracts/partners",
    "/contracts/products",
  ]) {
    await page.goto(path);
    await expect(page).toHaveURL(new RegExp(`${path.replaceAll("/", "\\/")}$`));
  }
  await page.goto("/contracts");
  const nav = page.getByRole("navigation", { name: "Điều hướng chính" });
  await expect(nav.getByRole("link", { name: "Tổng quan" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(nav.getByRole("link", { name: "Hợp đồng" })).not.toHaveAttribute(
    "aria-current",
    "page",
  );
});

test("`/` ⇒ home /contracts", async ({ page }) => {
  await installV2f(page);
  await page.goto("/");
  await expect(page).toHaveURL(/\/contracts$/);
});
