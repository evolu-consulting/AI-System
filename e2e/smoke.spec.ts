import { expect, test } from "@playwright/test";

// ADM-NFR-06 · M0-AC18 · sửa ở M1 (Q2): M1 có route guard nên "/" khi chưa đăng nhập chuyển sang /login.
test("ADM-NFR-06 · M0-AC18 · mở / thấy trang Đăng nhập", async ({ page }) => {
  const problems: string[] = [];
  page.on("console", (m) => {
    // Trình duyệt tự ghi "Failed to load resource … 401" cho lần refresh âm thầm của khách chưa đăng nhập
    // (POST /auth/refresh → 401 INVALID_REFRESH_TOKEN là hành vi đúng, plan-frontend §3.1). Chỉ bỏ qua đúng dòng đó.
    if (m.type() === "error" && !/Failed to load resource.*\b401\b/.test(m.text())) {
      problems.push(`console: ${m.text()}`);
    }
  });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));

  const res = await page.goto("/");
  expect(res?.status()).toBe(200);

  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Đăng nhập" })).toBeVisible();
  await expect(page).toHaveTitle("Đăng nhập · Admin");
  await expect(page.locator("html")).toHaveAttribute("lang", "vi");
  expect(problems).toEqual([]);
});
