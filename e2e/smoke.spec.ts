import { expect, test } from "@playwright/test";

test("ADM-NFR-06 · M0-AC18 · mở / thấy Admin Console", async ({ page }) => {
  const problems: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`console: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));

  const res = await page.goto("/");
  expect(res?.status()).toBe(200);

  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Admin Console" })).toBeVisible();
  await expect(page.getByText("Bảng quản trị nền tảng AI")).toBeVisible();

  const logo = page.getByRole("img", { name: "EvoluConsulting" });
  await expect(logo).toBeVisible();
  await expect
    .poll(() => logo.evaluate((el) => (el as unknown as { naturalWidth: number }).naturalWidth))
    .toBeGreaterThan(0);

  await expect(page).toHaveTitle("Admin Console");
  await expect(page.locator("html")).toHaveAttribute("lang", "vi");
  expect(problems).toEqual([]);
});
