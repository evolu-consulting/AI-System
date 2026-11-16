// CR-177 W1 · bàn phím cho lớp nổi: menu «Xuất ▾» (PopMenu), ngăn khoang trợ lý ở màn hẹp (DockSheet), nhóm nút chọn một (SegButton).
// Backend giả `page.route` như `gap-b-list.cw.ts`. CHƯA chạy lúc viết (chạy cuối đợt); chờ phần tử, không sleep.
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
  await page.route(at("contracts"), (r) => json(r, listAsHub()));
}

test("CR177-W1 · menu «Xuất»: Enter mở và đưa con trỏ vào mục đầu, ↓ sang mục kế, Esc đóng và trả focus nút", async ({
  page,
}) => {
  await install(page);
  await page.goto("/contracts/list");
  const btn = page.getByRole("button", { name: "Xuất", exact: true });
  await btn.focus();
  await page.keyboard.press("Enter");
  const items = page.getByRole("menuitem");
  await expect(items.first()).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(items.nth(1)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(btn).toBeFocused();
});

test("CR177-W1 · khoang trợ lý ở màn hẹp: Esc đóng ngăn, Tab không lọt ra ngoài ngăn", async ({
  page,
}) => {
  await install(page);
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto("/contracts/list");
  await page.getByTestId("topbar-feedback").click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  await expect(sheet).toHaveAttribute("aria-modal", "true");
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    expect(await sheet.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(page.getByTestId("topbar-feedback")).toBeFocused();
});

test("CR177-W1 · nhóm nút chọn một (loại hợp đồng): mũi tên chuyển và chọn nút kế", async ({
  page,
}) => {
  await install(page);
  await page.goto("/contracts/new");
  const group = page.getByRole("radiogroup").first();
  const radios = group.getByRole("radio");
  await radios.first().focus();
  await page.keyboard.press("ArrowRight");
  await expect(radios.nth(1)).toBeFocused();
  await expect(radios.nth(1)).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("ArrowLeft");
  await expect(radios.first()).toHaveAttribute("aria-checked", "true");
});
