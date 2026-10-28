// CR-102 · C12b · hỗ trợ e2e stack thật của community-web: đăng nhập 3 vai trên màn Đăng nhập riêng của community-web
// (com-fix-community-login; đối tác không qua chat-web), tenant demo.
// Mật khẩu KHÔNG nằm trong repo: đối tác lấy từ file `--out` của seed (`COMMUNITY_SEED_PW_FILE`, trường `users`) hoặc env
// `CS_PW_<USERNAME>`; chủ quản từ `DEMO_OWNER_PW`. Lần đăng nhập đầu của đối tác bị buộc đổi mật khẩu ⇒ đặt `CS_NEW_PW`.
import { readFileSync } from "node:fs";
import { type Browser, type BrowserContext, expect, type Page } from "@playwright/test";

export const TENANT = process.env.COMMUNITY_TENANT ?? "demo";
export const NEW_PW = process.env.CS_NEW_PW ?? "Cs-e2e-Pass-2026!";
export type Who = "host" | "supplier" | "buyer";
export const USERNAME: Record<Who, string> = {
  host: "demo-owner",
  supplier: "doitac-tanphat",
  buyer: "doitac-abc",
};
/** Nhãn hiển thị trong luồng/thẻ bài. */
export const ORG = { supplier: "Cơ sở Tân Phát", buyer: "Công ty TNHH ABC" } as const;
export const MASK_PHONE = "[SỐ ĐIỆN THOẠI]";

function pwOf(who: Who): string {
  const u = USERNAME[who];
  const env = process.env[`CS_PW_${u.toUpperCase().replace(/-/g, "_")}`];
  if (env) return env;
  if (who === "host") {
    if (!process.env.DEMO_OWNER_PW) throw new Error("cần DEMO_OWNER_PW");
    return process.env.DEMO_OWNER_PW;
  }
  const file = process.env.COMMUNITY_SEED_PW_FILE;
  if (!file) throw new Error("cần COMMUNITY_SEED_PW_FILE (file --out của seed) hoặc CS_PW_<USER>");
  const pw = (JSON.parse(readFileSync(file, "utf8")) as { users?: Record<string, string> }).users?.[
    u
  ];
  if (!pw) throw new Error(`file mật khẩu không có "${u}"`);
  return pw;
}

/** Mở community-web ⇒ màn Đăng nhập (Mã công ty / Tên đăng nhập / Mật khẩu) ⇒ bảng tin đã có phiên. */
export async function loginAs(page: Page, who: Who): Promise<void> {
  await page.goto("/");
  const pw = page.locator("input[type=password]").first();
  await pw.waitFor({ timeout: 45_000 });
  const tenant = page.getByRole("textbox", { name: /Mã công ty|Company code/ });
  if (await tenant.count()) await tenant.fill(TENANT);
  await page.getByRole("textbox", { name: /^(Tên đăng nhập|Username|Email)$/ }).fill(USERNAME[who]);
  await pw.fill(pwOf(who));
  await page.getByRole("button", { name: /^(Đăng nhập|Sign in)$/ }).click();
  // Đối tác mới: form đặt mật khẩu bắt buộc (mới + nhập lại) — chờ form đó HOẶC bảng tin (màn SPA, không tải lại trang).
  const change = page.getByRole("heading", { name: "Đặt mật khẩu mới" });
  const post = page.getByTestId("post").first();
  await expect(change.or(post)).toBeVisible({ timeout: 45_000 });
  if (await change.isVisible()) {
    const fields = page.locator("input[type=password]");
    for (let i = 0; i < (await fields.count()); i++) await fields.nth(i).fill(NEW_PW);
    await page.locator("button[type=submit]").first().click();
  }
  await expect(post).toBeVisible({ timeout: 45_000 });
}

/** Một context riêng (cookie riêng) mỗi vai, đã đăng nhập. */
export async function openAs(
  browser: Browser,
  who: Who,
): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({
    baseURL: process.env.COMMUNITY_URL ?? "http://localhost:3400",
  });
  const page = await ctx.newPage();
  await loginAs(page, who);
  return { ctx, page };
}

export const postByTitle = (page: Page, title: string) =>
  page.getByTestId("post").filter({ hasText: title });
