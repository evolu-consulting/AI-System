// CR-177 W4 · nút trợ lý nổi không đè nội dung: ở cuối danh sách HĐ, nút «›» của phân trang không giao với nút nổi (desktop + điện thoại).
// Backend giả `page.route` như `cr177-w1-overlays.cw.ts`. CHƯA chạy lúc viết (chạy cuối đợt); chờ phần tử, không sleep.
import { expect, type Page, type Route, test } from "@playwright/test";
import { asHub } from "./dataset";
import { categoriesAsHub, facetsAsHub, listAsHub, membersAsHub } from "./dataset-list";

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

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
  await page.route(at("contracts"), (r) => json(r, listAsHub([], 120)));
}

for (const vp of [
  { name: "1280x720", width: 1280, height: 720 },
  { name: "390x844", width: 390, height: 844 },
]) {
  test(`CR177-W4 · danh sách HĐ ${vp.name}: phân trang cuối không bị nút nổi đè`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await install(page);
    await page.goto("/contracts/list");
    const fab = page.getByTestId("assistant-fab");
    await expect(fab).toBeVisible();
    const next = page.getByRole("button", { name: "Trang sau", exact: false }).last();
    await next.scrollIntoViewIfNeeded();
    const [a, b] = [await fab.boundingBox(), await next.boundingBox()];
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    if (!a || !b) return;
    const overlap =
      a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
    expect(overlap).toBe(false);
  });
}
