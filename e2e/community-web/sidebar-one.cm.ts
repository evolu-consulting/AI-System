// CR-121 C-5 · thanh trái MỘT component: Community → Sổ Hợp Tác giữ nguyên cùng <nav data-testid="shell-sidebar">, mục đang chọn đúng.
import { expect, test } from "@playwright/test";

test("Community → Sổ Hợp Tác: cùng một thanh trái (shell-sidebar), mục đang chọn đổi đúng, không có thanh trái thứ hai", async ({
  page,
}) => {
  await page.goto("/community");
  await page.getByLabel("Chọn nhân vật").selectOption("an");
  const side = page.getByTestId("shell-sidebar");
  await expect(side).toHaveCount(1);
  await side.evaluate((el) => {
    (el as HTMLElement & { __same?: boolean }).__same = true;
  });
  await expect(side.locator('[data-nav-item="/community"]')).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(side.locator('[data-nav-item="/contracts"]')).not.toHaveAttribute(
    "aria-current",
    "page",
  );
  await side.locator('[data-nav-item="/contracts/list"]').click();
  await expect(page).toHaveURL(/\/contracts/);
  const after = page.getByTestId("shell-sidebar");
  await expect(after).toHaveCount(1);
  expect(await after.evaluate((el) => (el as HTMLElement & { __same?: boolean }).__same)).toBe(
    true,
  ); // cùng nút DOM, không dựng lại thanh trái
  await expect(after.locator('[data-nav-item="/contracts/list"]')).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(after.locator('[data-nav-item="/community"]')).not.toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.locator("aside.rail nav, nav.sidenav")).toHaveCount(0);
});
