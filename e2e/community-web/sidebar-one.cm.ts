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

// CR-121 C-6 · cùng khung nhìn: biểu tượng menu cùng cỡ, cụm nút Header cùng testid, một nút trợ lý (assistant-fab) ở cả hai module.
test("Community và Sổ Hợp Tác: icon menu cùng cỡ, cụm nút Header cùng testid, nút trợ lý cùng testid", async ({
  page,
}) => {
  const iconBox = async () =>
    page
      .getByTestId("shell-sidebar")
      .locator("[data-nav-item] svg")
      .first()
      .evaluate((el) => {
        const r = (el as SVGElement).getBoundingClientRect();
        return {
          w: Math.round(r.width),
          h: Math.round(r.height),
          sw: el.getAttribute("stroke-width"),
        };
      });
  await page.goto("/community");
  await page.getByLabel("Chọn nhân vật").selectOption("an");
  const cm = await iconBox();
  await expect(page.getByTestId("topbar-actions")).toHaveCount(1);
  await expect(page.getByTestId("topbar-bell")).toHaveCount(1);
  await expect(page.getByTestId("topbar-search")).toHaveCount(1);
  await expect(page.getByTestId("assistant-fab")).toHaveCount(1);
  await page.getByTestId("shell-sidebar").locator('[data-nav-item="/contracts/list"]').click();
  await expect(page).toHaveURL(/\/contracts/);
  const ct = await iconBox();
  expect(cm).toEqual({ w: 20, h: 20, sw: "1.8" });
  expect(ct).toEqual(cm);
  await expect(page.getByTestId("topbar-actions")).toHaveCount(1);
  await expect(page.getByTestId("topbar-bell")).toHaveCount(1);
  await expect(page.getByTestId("topbar-search")).toHaveCount(1);
  await expect(page.getByTestId("assistant-fab")).toHaveCount(1);
  // tooltip nhãn khi di chuột
  await page.getByTestId("assistant-fab").hover();
  await expect(page.getByRole("tooltip")).toHaveText("Hỏi trợ lý AI");
});
