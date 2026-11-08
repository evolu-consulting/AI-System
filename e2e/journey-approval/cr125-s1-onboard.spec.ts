// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: biến e2e/test, không ảnh hưởng cache build
// CR-125 · S1 · C1 · HÀNH TRÌNH THẬT, không seed bật sẵn gì: platform admin lập công ty MỚI bằng wizard ở ai-admin (tạo công ty → bật Sổ Hợp
// Tác → BỎ QUA bước Phân quyền → Xem lại → Hoàn tất); quản trị công ty đầu tiên đăng nhập bằng mật khẩu tạm (đổi mật khẩu) rồi mở Sổ Hợp Tác
// và THẤY danh sách hợp đồng — không bao giờ gặp "Bạn chưa có quyền dùng gói Hợp đồng".

import { toast } from "../support/helpers";
import { type Env, loginAdmin } from "./_journey";
import { expect, test } from "./_test";

const need = (n: string): string => {
  const v = process.env[n];
  if (!v) throw new Error(`${n} chưa đặt (playwright.journey.config.ts)`);
  return v;
};
const SFX = need("JA_D5_SUFFIX");
const CW = need("JA_CW_URL");
const KEY = `e2e-s1-${SFX}`;
const NAME = `E2E S1 ${SFX}`;
const ADMIN_USER = "s1admin";
const NEW_PW = `${need("JA_USER_PW")}-s1`;

test("platform admin lập công ty (bỏ qua bước Phân quyền) ⇒ quản trị công ty vào Sổ Hợp Tác thấy danh sách hợp đồng", async ({
  browser,
  page,
}) => {
  const env = {
    admin: need("JA_ADMIN_URL"),
    adminUser: need("SEED_ADMIN_USERNAME"),
    adminPw: need("SEED_ADMIN_PASSWORD"),
  } as Env;
  await loginAdmin(page, env);

  // Bước 1 · tạo công ty + quản trị công ty đầu tiên
  await page.goto(`${env.admin}/tenants/new`);
  await page.getByRole("textbox", { name: "Mã công ty" }).fill(KEY);
  await page.getByRole("textbox", { name: "Tên công ty" }).fill(NAME);
  await page.getByRole("textbox", { name: "Tên đăng nhập" }).fill(ADMIN_USER);
  await page.getByRole("textbox", { name: "Tên hiển thị" }).fill("Quản trị S1");
  await page.getByRole("textbox", { name: "Email" }).fill(`s1-${SFX}@s1.test`);
  await page.getByRole("button", { name: "Tạo tenant", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: `Đã tạo tenant ${KEY}` });
  const tempPw = await dialog.getByRole("textbox", { name: "Mật khẩu tạm" }).inputValue();
  expect(tempPw).toMatch(/^[A-Za-z0-9]{16}$/);
  await dialog.getByRole("checkbox", { name: "Tôi đã lưu mật khẩu tạm" }).check();
  await dialog.getByRole("button", { name: "Tiếp tục cấu hình" }).click();

  // Bước 2 · bật Sổ Hợp Tác ở mức Quản trị (đường UI thật: không công tắc nào khác)
  await expect(page).toHaveURL(/step=2/);
  const card = page.getByTestId("apps-row-contracts");
  await card.getByLabel("Mức dùng Sổ Hợp Tác").getByRole("radio", { name: "Quản trị" }).click();
  await page.getByRole("button", { name: "Lưu", exact: true }).click();
  await expect(toast(page, "Đã lưu tính năng cho")).toBeVisible();
  await page.getByRole("button", { name: "Tiếp tục", exact: true }).click();

  // Bước 3 · BỎ QUA phân quyền (đúng điều trước đây làm quản trị bị khoá ngoài)
  await page.getByRole("button", { name: "Bỏ qua" }).click();

  // Bước 4 · Xem lại = danh sách việc còn thiếu: chưa có người dùng khác, nhưng KHÔNG báo "chưa ai có vai"
  const todo = page.getByTestId("wizard-todo");
  await expect(todo).toBeVisible();
  await expect(todo.getByTestId("wizard-todo-noUsers")).toBeVisible();
  await expect(todo.getByTestId("wizard-todo-noPeople")).toHaveCount(0);
  await page.getByRole("button", { name: "Hoàn tất" }).click();

  // Quản trị công ty đầu tiên: đăng nhập Sổ Hợp Tác bằng mật khẩu tạm → đổi mật khẩu → thấy danh sách hợp đồng
  const adminPage = await (
    await browser.newContext({ locale: "vi-VN", viewport: { width: 1440, height: 900 } })
  ).newPage();
  await adminPage.goto(`${CW}/login`);
  await adminPage.getByRole("textbox", { name: "Mã công ty" }).fill(KEY);
  await adminPage.getByRole("textbox", { name: "Email" }).fill(ADMIN_USER);
  await adminPage.getByLabel("Mật khẩu", { exact: true }).fill(tempPw);
  await adminPage.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(adminPage.getByRole("heading", { name: "Đặt mật khẩu mới" })).toBeVisible();
  await adminPage.getByLabel("Mật khẩu mới", { exact: true }).fill(NEW_PW);
  await adminPage.getByLabel("Nhập lại mật khẩu mới").fill(NEW_PW);
  await adminPage.getByRole("button", { name: "Lưu mật khẩu" }).click();
  await expect(adminPage).not.toHaveURL(/change-password|\/login/);

  await adminPage.goto(`${CW}/contracts/list`);
  await expect(adminPage.locator('input[type="file"]')).toBeAttached({ timeout: 30_000 });
  await expect(adminPage.getByText("Bạn chưa có quyền dùng gói Hợp đồng")).toHaveCount(0);
});
