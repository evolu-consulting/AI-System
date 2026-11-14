// CR-158 · icon tab trình duyệt theo logo công ty. Backend giả `page.route`; không sleep. Viết, chưa chạy.
import { expect, test } from "@playwright/test";
import { installV2f } from "./v2f-support";

test.skip(process.env.CW_MODE === "ref", "chỉ kiểm hành vi contracts-web");

const LOGO =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16'/>";

test("Công ty có logo: icon tab dùng logo đó", async ({ page }) => {
  await installV2f(page);
  await page.route("**/api/**/company**", async (r) => {
    const res = await r.fetch();
    const j = await res.json();
    if (j?.company) j.company.logo = LOGO;
    await r.fulfill({ response: res, json: j });
  });
  await page.goto("/contracts/c");
  await expect(page.locator('link[rel~="icon"]')).toHaveAttribute("href", LOGO);
});
