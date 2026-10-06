/// <reference lib="dom" />
// X1 combine e2e · helper: đăng nhập chat/admin bằng user fixture M1 (mật khẩu `PW`), đọc nhật ký lời gọi của Dify mock.
import { expect, type Page } from "@playwright/test";
import { PW } from "../../tests/acceptance/M1/_data";
import { ID, id2 } from "../../tests/acceptance/M2/_data";

export { ID, PW };
export const ADMIN_URL = process.env.COMBINE_ADMIN_URL ?? "http://localhost:3020";
export const DIFY_URL = process.env.COMBINE_DIFY_URL ?? "http://localhost:4048";
/** Id cố định do `_prepare.ts` chèn (id2 60–65). */
export const X1_IDS = {
  wfSend: id2(61),
  wfDich: id2(62),
  cmdSend: id2(63),
  cmdDich: id2(64),
} as const;
/** Câu trả lời cố định của Dify mock (kịch bản `ok`: CHUNKS nối lại). */
export const MOCK_TEXT = "Xin chào, đây là mock.";

/** Đăng nhập chat-web (đi qua admin-api `/auth/login`, AUTH_URL) bằng user fixture M1 của tenant acme. */
export async function chatLogin(page: Page, user: string, tenant = "acme"): Promise<void> {
  await page.goto("/login");
  await page.getByRole("textbox", { name: "Mã công ty" }).fill(tenant);
  await page.getByRole("textbox", { name: "Tên đăng nhập" }).fill(user);
  await page.getByLabel("Mật khẩu").fill(PW);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await page.waitForURL(/\/c\/new$/);
}

/** Đăng nhập admin-web (cổng 3020) bằng platform_admin seed. */
export async function adminLogin(page: Page): Promise<void> {
  const user = process.env.SEED_ADMIN_USERNAME ?? "";
  const pass = process.env.SEED_ADMIN_PASSWORD ?? "";
  await page.goto(`${ADMIN_URL}/login`);
  await page.getByRole("textbox", { name: "Mã công ty" }).fill("platform");
  await page.getByRole("textbox", { name: "Tên đăng nhập" }).fill(user);
  await page.getByLabel("Mật khẩu", { exact: true }).fill(pass);
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Tổng quan" })).toBeVisible();
}

export type DifyCall = { path: string; auth: string; body: unknown; at: number };
/** Mọi lời gọi chạy workflow tới Dify mock từ lúc dựng stack (lọc `/v1/workflows/run`). */
export async function difyRuns(): Promise<DifyCall[]> {
  const r = await fetch(`${DIFY_URL}/__mock/requests`);
  const j = (await r.json()) as { requests: DifyCall[] };
  return j.requests.filter((c) => c.path === "/v1/workflows/run");
}

export const composer = (page: Page) =>
  page.getByRole("textbox", { name: "Tin nhắn", exact: true });
export const chatLog = (page: Page) => page.getByRole("log", { name: "Nội dung hội thoại" });

export async function sendChat(page: Page, text: string): Promise<void> {
  await composer(page).fill(text);
  await composer(page).press("Enter");
}
