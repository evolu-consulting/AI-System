// CR-121 C1 · khung "Hướng A": đổi giao diện từ menu avatar; sidebar đổi màu theo giao diện tối; mặc định Sáng.
import { expect, test } from "@playwright/test";
import { loginAdmin, resetFixture } from "./support/helpers";

test.describe.configure({ mode: "serial" });
test.beforeAll(() => {
  resetFixture();
});

const sidebarBg = (page: import("@playwright/test").Page) =>
  page
    .locator("aside")
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundColor);

async function openAccountMenu(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Tài khoản của bạn" }).click();
}

test("CR-121 · chọn Tối ở menu avatar thì trang và sidebar đổi màu", async ({ page }) => {
  await loginAdmin(page);
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  const light = await sidebarBg(page);

  await openAccountMenu(page);
  await page
    .getByRole("radiogroup", { name: "Giao diện" })
    .getByRole("radio", { name: "Tối" })
    .click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  const dark = await sidebarBg(page);
  expect(dark).not.toBe(light);

  await page.keyboard.press("Escape");
  await openAccountMenu(page);
  await page
    .getByRole("radiogroup", { name: "Giao diện" })
    .getByRole("radio", { name: "Sáng" })
    .click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  expect(await sidebarBg(page)).toBe(light);
});

test("CR-121 · nút icon có nhãn khi rê chuột và chỉ một nhóm chọn giao diện", async ({ page }) => {
  await loginAdmin(page);
  await expect(page.getByRole("radiogroup", { name: "Giao diện" })).toHaveCount(0);
  await page.getByRole("button", { name: "Tài khoản của bạn" }).hover();
  await expect(page.getByRole("tooltip").first()).toContainText("Tài khoản của bạn");
  await openAccountMenu(page);
  await expect(page.getByRole("radiogroup", { name: "Giao diện" })).toHaveCount(1);
});
