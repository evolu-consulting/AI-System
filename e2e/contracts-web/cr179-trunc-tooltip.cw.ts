// CR-179 · chữ cắt có tooltip: tên HĐ dài ở danh sách HĐ bị cắt «…»; rê chuột ⇒ tooltip đủ chữ. CHƯA chạy lúc viết (chạy cuối đợt).
import { expect, type Page, type Route, test } from "@playwright/test";
import { asHub } from "./dataset";
import { categoriesAsHub, facetsAsHub, listAsHub, membersAsHub } from "./dataset-list";

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

const LONG =
  "Hợp đồng nguyên tắc cung cấp bao bì giấy carton nhiều lớp cho toàn bộ hệ thống nhà máy miền Bắc giai đoạn 2026-2028";

async function install(page: Page) {
  const d = asHub("editor");
  await page.addInitScript(() => {
    try {
      localStorage.setItem("ai.locale", "vi");
      localStorage.setItem("assistant:open", "0");
    } catch {
      /* storage bị chặn */
    }
  });
  await page.route("**/auth/refresh", (r) => json(r, d.grant));
  await page.route("**/pack/contracts/me", (r) => json(r, d.packMe));
  const at = (n: string) => (u: URL) => u.pathname === `/pack/contracts/${n}`;
  await page.route(at("contracts/facets"), (r) => json(r, facetsAsHub()));
  await page.route(at("categories"), (r) => json(r, categoriesAsHub()));
  await page.route(at("members"), (r) => json(r, membersAsHub()));
  await page.route(at("contracts"), (r) =>
    json(r, listAsHub([{ id: "c1790000-0000-4000-8000-000000000001", title: LONG }])),
  );
}

test("CR179 · danh sách HĐ: tên HĐ dài bị cắt, rê chuột hiện tooltip đủ chữ", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await install(page);
  await page.goto("/contracts/list");
  const name = page.getByTestId("contract-name").filter({ hasText: "Hợp đồng nguyên tắc" });
  await expect(name).toBeVisible();
  await name.hover();
  await expect(page.getByRole("tooltip").filter({ hasText: LONG })).toBeVisible();
});
