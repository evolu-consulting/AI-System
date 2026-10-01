// ADM-FR-01 · helper dùng chung cho e2e M1 (chạy trong Node/Playwright: không dùng API riêng của Bun).
import { execFileSync } from "node:child_process";
import { expect, type Page } from "@playwright/test";
import postgres from "postgres";

export { PW, TEMP_PW, TENANT_ID, USER_ID } from "../../tests/acceptance/M1/_data";

function loadEnvOnce(): void {
  if (process.env.TEST_DATABASE_URL) return;
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // không có .env.local: để need() báo thiếu biến
  }
}

export function need(name: string): string {
  loadEnvOnce();
  const v = process.env[name];
  if (!v) throw new Error(`${name} chưa đặt — chạy \`bun run keys:dev\` (hoặc đặt trong CI)`);
  return v;
}

/** Tài khoản platform_admin do seed tạo (cùng nguồn env với prepare-db). */
export const seedAdmin = () => ({
  username: need("SEED_ADMIN_USERNAME"),
  password: need("SEED_ADMIN_PASSWORD"),
});

/** Khôi phục dữ liệu fixture (truncate + seed + fixture) bằng prepare-db; dùng ở `test.beforeAll` mỗi file. */
export function resetFixture(): void {
  execFileSync("bun", ["e2e/support/prepare-db.ts", "--reset-only"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      TEST_DATABASE_URL: need("TEST_DATABASE_URL"),
      SEED_ADMIN_USERNAME: seedAdmin().username,
      SEED_ADMIN_PASSWORD: seedAdmin().password,
    },
    stdio: "inherit",
  });
}

/** Kết nối owner tới DB test cho một thao tác rồi đóng. */
export async function withOwner<T>(fn: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const sql = postgres(need("TEST_DATABASE_URL"), { max: 1, onnotice: () => {} });
  try {
    return await fn(sql);
  } finally {
    await sql.end();
  }
}

/** Đăng nhập qua giao diện (nhãn nguyên văn plan-frontend §8). Không chờ trang đích. */
export async function fillLogin(page: Page, tenant: string, username: string, password: string) {
  await page.getByRole("textbox", { name: "Mã công ty" }).fill(tenant);
  await page.getByRole("textbox", { name: "Tên đăng nhập" }).fill(username);
  await page.getByLabel("Mật khẩu", { exact: true }).fill(password);
}

export async function loginUI(page: Page, tenant: string, username: string, password: string) {
  await page.goto("/login");
  await fillLogin(page, tenant, username, password);
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
}

/** Đăng nhập thành công vào khung quản trị (admin): chờ heading Tổng quan. */
export async function loginToShell(page: Page, tenant: string, username: string, password: string) {
  await loginUI(page, tenant, username, password);
  await expect(page.getByRole("heading", { level: 1, name: "Tổng quan" })).toBeVisible();
}

export async function logoutUI(page: Page) {
  await page.getByRole("button", { name: "Tài khoản của bạn" }).click();
  await page.getByRole("menuitem", { name: "Đăng xuất" }).click();
  await expect(page).toHaveURL(/\/login/);
}

/** Dòng bảng theo ô tên đăng nhập/mã (khớp đúng nội dung ô). */
export function rowOf(page: Page, table: string, cellText: string | RegExp) {
  return page
    .getByRole("table", { name: table })
    .getByRole("row")
    .filter({
      has: page.getByRole("cell", { name: cellText, exact: typeof cellText === "string" }),
    });
}
