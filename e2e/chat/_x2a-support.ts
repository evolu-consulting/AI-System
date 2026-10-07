/// <reference lib="dom" />
// HUB-FR-96…102 · CHAT-AC-37…45 · e2e X2a · helper (test-plan X2a §6; nhãn nguyên văn `plan-frontend-e2e.md` §1): đăng nhập
// chat-web qua admin-api (AUTH_URL), gọi Hub thật để dựng dữ liệu TRONG ca (phòng, nhóm 49), locator theo role + nhãn.
// User fixture M1 (mật khẩu `PW`): A = `lan` "Lan Tran", B = `thu` "Thu Ha", `an` "An Nguyen" (acme), `khang` (globex).
import { type Browser, expect, type Page } from "@playwright/test";
import { PW, TENANT_ID, USER_ID } from "../../tests/acceptance/M1/_data";
import { QE } from "./_x2a-data";

export { PW, QE, USER_ID };
// biome-ignore lint/suspicious/noUndeclaredEnvVars: biến e2e (playwright.x2a.config đặt)
export const HUB = process.env.X2A_HUB_URL ?? "http://localhost:4050";
// biome-ignore lint/suspicious/noUndeclaredEnvVars: biến e2e (playwright.x2a.config đặt)
export const AUTH = process.env.X2A_API_URL ?? "http://localhost:3031";
export const NAMES = {
  lan: "Lan Tran",
  thu: "Thu Ha",
  an: "An Nguyen",
  khang: "Khang Ly",
} as const;
export const ACME = TENANT_ID.acme;

/** Đăng nhập chat-web (tenant acme mặc định). */
export async function chatLogin(page: Page, user: string, tenant = "acme"): Promise<void> {
  await page.goto("/login");
  await page.getByRole("textbox", { name: "Mã công ty" }).fill(tenant);
  await page.getByRole("textbox", { name: "Tên đăng nhập" }).fill(user);
  await page.getByLabel("Mật khẩu").fill(PW);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await page.waitForURL(/\/c\/new$/);
}

/** Hai context độc lập (A, B), mỗi bên đã đăng nhập. */
export async function twoUsers(browser: Browser, a = "lan", b = "thu") {
  const ca = await browser.newContext();
  const cb = await browser.newContext();
  const pa = await ca.newPage();
  const pb = await cb.newPage();
  await chatLogin(pa, a);
  await chatLogin(pb, b);
  return { pa, pb, close: async () => Promise.all([ca.close(), cb.close()]) };
}

// ---------- API thật (dựng dữ liệu trong ca) ----------
export async function token(user: string, tenant = "acme"): Promise<string> {
  const r = await fetch(`${AUTH}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tenant_key: tenant, username: user, password: PW }),
  });
  expect(r.status).toBe(200);
  return ((await r.json()) as { access_token: string }).access_token;
}
// biome-ignore lint/suspicious/noExplicitAny: body JSON của Hub; ca tự kiểm
type Json = any;
export async function hub(
  tok: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: Json }> {
  const r = await fetch(`${HUB}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${tok}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  return { status: r.status, json: text ? JSON.parse(text) : undefined };
}
let n = 0;
const cmid = () =>
  `a2e10000-0000-4000-8000-${String(Date.now() % 1e9).padStart(9, "0")}${String(n++ % 1000).padStart(3, "0")}`;
export async function apiGroup(tok: string, name: string, memberIds: string[]): Promise<string> {
  const r = await hub(tok, "POST", "/rooms", { kind: "group", name, member_ids: memberIds });
  expect(r.status).toBe(201);
  return r.json.id as string;
}
export async function apiDm(tok: string, peerId: string): Promise<string> {
  const r = await hub(tok, "POST", "/rooms", { kind: "dm", user_id: peerId });
  expect([200, 201]).toContain(r.status);
  return r.json.id as string;
}
export async function apiSay(tok: string, roomId: string, content: string): Promise<void> {
  const r = await hub(tok, "POST", `/rooms/${roomId}/messages`, { content, client_msg_id: cmid() });
  expect(r.status).toBe(201);
}
/** Tên duy nhất mỗi lần chạy (DB e2e dùng lại giữa các ca). */
export const uniq = (p: string) => `${p} ${Date.now().toString(36)}`;

// ---------- locator (plan-frontend-e2e §1) ----------
export const roomsRegion = (p: Page) => p.getByRole("region", { name: "Tin nhắn & Nhóm" });
export const aiRegion = (p: Page) => p.getByRole("region", { name: "Hỏi AI" });
export const search = (p: Page) => p.getByRole("searchbox", { name: "Tìm hội thoại, người, nhóm" });
export const roomLink = (p: Page, name: string) =>
  roomsRegion(p).getByRole("link", { name, exact: true });
export const roomLog = (p: Page) => p.getByRole("log", { name: "Tin nhắn của phòng" });
export const roomComposer = (p: Page, target: string) =>
  p.getByRole("textbox", { name: `Tin nhắn cho ${target}` });
export const badgeOf = (p: Page, name: string) => roomLink(p, name).getByTestId("unread-badge");
export const roomOptions = (p: Page) => p.getByRole("button", { name: "Tuỳ chọn phòng" });

export async function sendInRoom(p: Page, target: string, text: string): Promise<void> {
  const box = roomComposer(p, target);
  await box.fill(text);
  await p.getByRole("button", { name: "Gửi" }).click();
  await expect(roomLog(p).getByRole("article").filter({ hasText: text })).toBeVisible();
}
