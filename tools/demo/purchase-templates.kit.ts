// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: kịch bản demo đọc biến môi trường
// CR-125 · cr125-purchase-templates · phần dùng chung của `purchase-templates.ts` (dựng) và `purchase-templates.run.ts` (chạy).
import { mkdirSync } from "node:fs";
import type { Page } from "@playwright/test";
import { urlsFromBase } from "./purchase-flow-setup";

export const u = urlsFromBase();
export const SHOTS = process.env.SHOTS_DIR ?? "docs/specs/cr125-purchase-templates/shots";
mkdirSync(SHOTS, { recursive: true });
export const log = (s: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`);

export async function loginAdmin(page: Page, tenant: string, user: string, pw: string) {
  await page.goto(`${u.web}/login`);
  await page.getByRole("textbox", { name: "Mã công ty" }).fill(tenant);
  await page.getByRole("textbox", { name: "Tên đăng nhập" }).fill(user);
  await page.getByLabel("Mật khẩu", { exact: true }).fill(pw);
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await page.waitForURL((x) => !x.pathname.startsWith("/login"));
  await page.waitForTimeout(1200);
}
