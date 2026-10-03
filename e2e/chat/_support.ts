/// <reference lib="dom" />
// CHAT-AC-35 · helper dùng chung cho e2e chat-web (Node/Playwright, không dùng API riêng của Bun).
import { type ChatEvent, createSseParser, toChatEvent } from "@ai/contracts/chat";
import { expect, type Locator, type Page, type Request, type Response } from "@playwright/test";

export const HUB_PORT = Number(process.env.CHAT_E2E_HUB_PORT ?? 4020);
export const HUB = `http://localhost:${HUB_PORT}`;
export const PASSWORD = "dev-password-1";
export const SEND_PATH = /\/conversations\/[^/]+\/messages$/;

export async function resetMock(): Promise<void> {
  const r = await fetch(`${HUB}/__mock/reset`, { method: "POST" });
  if (r.status !== 204) throw new Error(`/__mock/reset → ${r.status}`);
}

export async function expireAccess(): Promise<void> {
  const r = await fetch(`${HUB}/__mock/expire-access`, { method: "POST" });
  if (r.status !== 204) throw new Error(`/__mock/expire-access → ${r.status}`);
}

/** Access token qua HTTP trực tiếp (để đọc E11 ngoài trình duyệt). */
export async function apiToken(tenant = "acme", username = "minh"): Promise<string> {
  const r = await fetch(`${HUB}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tenant_key: tenant, username, password: PASSWORD }),
  });
  const j = (await r.json()) as { access_token: string };
  return j.access_token;
}

export async function fillLogin(
  page: Page,
  tenant: string,
  user: string,
  pw: string,
): Promise<void> {
  await page.getByRole("textbox", { name: "Mã công ty" }).fill(tenant);
  await page.getByRole("textbox", { name: "Tên đăng nhập" }).fill(user);
  await page.getByLabel("Mật khẩu").fill(pw);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
}

/** Đăng nhập `acme/minh` (hoặc user khác) và chờ `/c/new`. */
export async function login(page: Page, user = "minh", tenant = "acme"): Promise<void> {
  await page.goto("/login");
  await fillLogin(page, tenant, user, PASSWORD);
  await page.waitForURL(/\/c\/new$/);
}

export const isSend = (r: Request): boolean =>
  r.method() === "POST" && SEND_PATH.test(new URL(r.url()).pathname);

export type SentBody = { content: string; flow_id?: string };

/** Chờ request E12 kế tiếp; trả body đã parse. */
export function nextSend(page: Page): Promise<SentBody> {
  return page.waitForRequest(isSend).then((r) => r.postDataJSON() as SentBody);
}

export const nextSendResponse = (page: Page): Promise<Response> =>
  page.waitForResponse((r) => isSend(r.request()));

export function log(page: Page): Locator {
  return page.getByRole("log", { name: "Nội dung hội thoại" });
}

export function article(page: Page, title: string): Locator {
  return log(page).getByRole("article", { name: `Flow: ${title}` });
}

export const flows = (page: Page): Locator => log(page).getByRole("article");

/** Mở hội thoại seed bằng link ở sidebar (trên mobile mở ngăn trước). */
export async function openConversation(page: Page, title: string): Promise<void> {
  const link = page.getByRole("link", { name: title, exact: true });
  const narrow = (page.viewportSize()?.width ?? 1280) < 1024;
  if (narrow) await page.getByRole("button", { name: "Danh sách hội thoại" }).click();
  await expect(link).toBeVisible();
  await link.click();
  await page.waitForURL(/\/c\/[0-9a-f-]{36}/);
  await expect(flows(page).first()).toBeVisible();
}

export function composer(page: Page): Locator {
  return page.getByRole("textbox", { name: "Tin nhắn", exact: true });
}

/** Gõ vào composer chính và gửi bằng Enter. */
export async function sendMain(page: Page, text: string): Promise<void> {
  await composer(page).fill(text);
  await composer(page).press("Enter");
}

export function parseSse(body: string): ChatEvent[] {
  const out: ChatEvent[] = [];
  createSseParser((raw) => out.push(toChatEvent(raw)))(body);
  return out;
}

/** `content` của `run.finished` trong thân SSE của E12. */
export function finishedContent(body: string): string {
  const e = parseSse(body).find((x) => x.event === "run.finished");
  if (!e || e.event !== "run.finished") throw new Error("SSE không có run.finished");
  return e.data.content;
}

/** Cài MutationObserver ghi lại mọi giá trị độ dài `innerText` của `log` (E-S2: text tăng dần). */
export async function watchGrowth(page: Page): Promise<() => Promise<number[]>> {
  await page.evaluate(() => {
    const w = window as unknown as { __lens: Set<number> };
    w.__lens = new Set();
    const rec = (): void => {
      const el = document.querySelector('[role="log"]');
      if (el) w.__lens.add((el as HTMLElement).innerText.length);
    };
    new MutationObserver(rec).observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  });
  return () =>
    page.evaluate(() =>
      [...(window as unknown as { __lens: Set<number> }).__lens].sort((a, b) => a - b),
    );
}

/** Phần tử cuộn của luồng: `log` hoặc tổ tiên gần nhất có thể cuộn. */
export function scrollerHandle(
  page: Page,
): Promise<import("@playwright/test").JSHandle<HTMLElement>> {
  return page.evaluateHandle(() => {
    let el: HTMLElement | null = document.querySelector('[role="log"]');
    while (el && el.scrollHeight <= el.clientHeight + 1) el = el.parentElement;
    return (el ?? document.documentElement) as HTMLElement;
  });
}

export async function openSettings(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "Cài đặt" }).click();
  const dlg = page.getByRole("dialog", { name: "Cài đặt" });
  await expect(dlg).toBeVisible();
  return dlg;
}
