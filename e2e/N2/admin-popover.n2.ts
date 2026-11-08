// CR-125 c4b · ô ngày trong Popover "Thời gian" của Nhật ký: bấm biểu tượng lịch bằng chuột KHÔNG được đóng popover ngoài; chọn ngày
// đưa giá trị dd/mm/yyyy vào ô và popover ngoài vẫn mở (để bấm "Áp dụng"). Chạy trên stack admin có sẵn (PA_ADMIN_URL) — không seed.
import { expect, test } from "@playwright/test";

// biome-ignore lint/suspicious/noUndeclaredEnvVars: biến e2e (playwright.n2.config đặt)
const ADMIN = process.env.PA_ADMIN_URL ?? "http://localhost:5345";

test("CR-125 c4b · lịch trong popover Thời gian không đóng popover ngoài", async ({ page: p }) => {
  await p.goto(`${ADMIN}/login`);
  await p.getByRole("textbox", { name: "Mã công ty" }).fill("platform");
  await p
    .getByRole("textbox", { name: "Tên đăng nhập" })
    .fill(process.env.SEED_ADMIN_USERNAME ?? "");
  await p.getByLabel("Mật khẩu", { exact: true }).fill(process.env.SEED_ADMIN_PASSWORD ?? "");
  await p.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await p.waitForURL((u) => !u.pathname.startsWith("/login"));
  await p.goto(`${ADMIN}/audit`);
  await p.getByRole("button", { name: /^(Period|Thời gian):/ }).click();
  const outer = p.locator("[data-slot=popover-content]");
  await expect(p.locator("#period-from")).toBeVisible();
  await outer.getByRole("button", { name: "Chọn ngày" }).first().click();
  const cal = p.getByTestId("date-popover");
  await expect(cal).toBeVisible();
  await expect(p.locator("#period-from")).toBeVisible();
  await cal
    .getByRole("button", { name: /^15\/\d\d\/\d{4}$/ })
    .first()
    .click();
  await expect(p.locator("#period-from")).toHaveValue(/^15\/\d\d\/\d{4}$/);
  await expect(outer.locator("button").last()).toBeVisible();
});
