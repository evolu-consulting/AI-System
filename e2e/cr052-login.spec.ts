// CR-052 · login Admin (phương án C) + EN mặc định, bỏ dò ngôn ngữ trình duyệt. Chạy trên config gốc (admin-web :3000).
import { expect, type Page, test } from "@playwright/test";

const SHOWCASE = "Companies, people and permissions. One place.";
const SHOWCASE_VI = "Công ty, con người và phân quyền. Gói gọn một nơi.";
const showcase = (page: Page) => page.getByRole("heading", { level: 2, name: SHOWCASE });

// Context sạch: trình duyệt vi-VN, KHÔNG có storageState (không có locale đã lưu).
test.use({ locale: "vi-VN", storageState: { cookies: [], origins: [] } });

test("[CR-052] trình duyệt vi-VN, chưa lưu ngôn ngữ → login hiện tiếng Anh ('Sign in'), tab = Evolu Control", async ({
  page,
}) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page).toHaveTitle("Evolu Control");
  await expect(page.getByRole("button", { name: "Tiếng Việt", exact: true })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
});

test("[CR-052] công tắc EN/VI đổi sang tiếng Việt và giữ sau khi tải lại", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Tiếng Việt", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Đăng nhập" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "vi");
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Đăng nhập" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: SHOWCASE_VI })).toBeVisible();
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
});

test("[CR-052] cột showcase bên phải hiện ở ≥ 1024px và ẩn ở < 1024px; form luôn dùng được", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/login");
  await expect(showcase(page)).toBeVisible();
  await page.setViewportSize({ width: 1023, height: 800 });
  await expect(showcase(page)).toBeHidden();
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  await page.setViewportSize({ width: 1024, height: 800 });
  await expect(showcase(page)).toBeVisible();
});
