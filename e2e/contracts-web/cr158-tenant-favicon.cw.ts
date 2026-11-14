// CR-158 · icon tab trình duyệt theo logo công ty. Backend giả `page.route`; không sleep.
import { expect, test } from "@playwright/test";
import { installV2f } from "./v2f-support";

test.skip(process.env.CW_MODE === "ref", "chỉ kiểm hành vi contracts-web");

const LOGO =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16'/>";

test("Công ty có logo: icon tab dùng logo đó", async ({ page }) => {
  await installV2f(page);
  await page.route("**/pack/contracts/company", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        company: {
          name: "Acme",
          app_name: null,
          logo: LOGO,
          accent: "indigo",
          theme: "light",
          own_names: [],
          own_tax_ids: [],
        },
        approval_enabled: true,
        allow_negative_stock: false,
        defaults: {},
        version: 0,
        updated_at: null,
      }),
    }),
  );
  await page.goto("/contracts/list");
  await expect(page.locator('link[rel~="icon"]')).toHaveAttribute("href", LOGO);
});
