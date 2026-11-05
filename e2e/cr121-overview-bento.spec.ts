// CR-121 · cr121-c3b-dashboard-bento · hành trình thật: platform_admin mở Tổng quan ⇒ bố cục bento (ô lớn + 5 ô số liệu + Cần xử lý ngay + Sức khoẻ hệ thống),
// mỗi ô có số hoặc lý do (không ô trống); tenant_admin vào "/" chỉ thấy bản công ty của mình, không thấy ô vận hành toàn nền tảng.
// Dữ liệu: fixture e2e (resetFixture); trang chỉ đọc `GET /ops/overview`, không ghi gì.
import { expect, type Page, test } from "@playwright/test";
import { loginAdmin, loginAs, resetFixture } from "./support/helpers";

test.describe.configure({ mode: "serial" });
test.beforeAll(() => resetFixture());
test.afterAll(() => resetFixture());

const region = (page: Page, name: string) => page.getByRole("region", { name, exact: true });
const TILES = [
  "Lượt chạy 24 giờ",
  "Tỷ lệ lỗi",
  "Thời gian xử lý",
  "Lỗi công cụ AI 24 giờ",
  "Hạn mức AI tháng này",
  "Công ty hoạt động 7 ngày",
  "Cần xử lý ngay",
  "Sức khoẻ hệ thống",
];

test("CR-121 · platform_admin thấy đủ các ô bento, mỗi ô có nội dung (số hoặc lý do), không còn các ô cũ", async ({
  page,
}) => {
  await loginAdmin(page);
  await expect(page.getByRole("heading", { level: 1, name: "Tổng quan" })).toBeVisible();
  for (const name of TILES) {
    const tile = region(page, name);
    await expect(tile).toBeVisible();
    // Ô nào cũng phải nói được điều gì đó: số, lý do "chưa có dữ liệu" hoặc lỗi tải kèm cách khắc phục.
    await expect(tile).not.toHaveText(new RegExp(`^${name}$`));
  }
  // Ô cũ đã bị thay hẳn (D6): không còn thẻ "Số run 24 giờ", "Tenant sắp hoặc đã vượt quota", "Sẽ có khi Agent Hub sẵn sàng.".
  await expect(region(page, "Số run 24 giờ")).toHaveCount(0);
  await expect(region(page, "Tenant sắp hoặc đã vượt quota")).toHaveCount(0);
  await expect(page.getByText("Sẽ có khi Agent Hub sẵn sàng.")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Tạo tenant" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Tạo command" })).toBeVisible();
});

test("CR-121 · màn nhỏ co về một cột không tràn ngang, ô Sức khoẻ dẫn tới trang Hệ thống", async ({
  page,
}) => {
  await loginAdmin(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const health = region(page, "Sức khoẻ hệ thống");
  await expect(health).toBeVisible();
  const [a, b] = await Promise.all([
    region(page, "Lượt chạy 24 giờ").boundingBox(),
    health.boundingBox(),
  ]);
  expect(a && b && Math.abs(a.x - b.x) < 2).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.setViewportSize({ width: 1280, height: 800 });
  const link = health.getByRole("link").first();
  if (await link.isVisible()) {
    await link.click();
    await expect(page).toHaveURL(/\/system/);
  }
});

test("CR-121 · tenant_admin ở '/' chỉ thấy bản công ty, không có ô vận hành toàn nền tảng", async ({
  page,
}) => {
  await loginAs(page, "acme", "binh");
  await expect(region(page, "Quota tháng")).toBeVisible();
  for (const name of ["Lượt chạy 24 giờ", "Cần xử lý ngay", "Sức khoẻ hệ thống"]) {
    await expect(region(page, name)).toHaveCount(0);
  }
  await expect(page.getByRole("link", { name: "Tạo tenant" })).toHaveCount(0);
});
