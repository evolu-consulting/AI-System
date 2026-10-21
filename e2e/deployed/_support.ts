// e2e triển khai · hỗ trợ chung. Mật khẩu CHỈ qua env `DEMO_PW` (runner đọc từ máy chủ trong bộ nhớ) — không in, không ghi file.
import {
  test as base,
  type ConsoleMessage,
  expect,
  type Page,
  request as playwrightRequest,
} from "@playwright/test";

// DEP_DOMAIN=evoluconsulting.com => chay qua https host thu nghiem (sohoptac-test./ai-test-admin./ai-test./ai-test-hub.<domain>) thay vi SSH tunnel;
// DEP_*_URL van thang. Khong dat gi => localhost:1843x (tunnel).
const DOM = process.env.DEP_DOMAIN?.trim();
export const CW =
  process.env.DEP_CONTRACTS_URL ??
  (DOM ? `https://sohoptac-test.${DOM}` : "http://localhost:18431");
export const ADMIN =
  process.env.DEP_ADMIN_URL ?? (DOM ? `https://ai-test-admin.${DOM}` : "http://localhost:18432");
export const CHAT =
  process.env.DEP_CHAT_URL ?? (DOM ? `https://ai-test.${DOM}` : "http://localhost:18433");
export const HUB =
  process.env.DEP_HUB_URL ?? (DOM ? `https://ai-test-hub.${DOM}` : "http://localhost:18434");
export const TENANT = "demo";
export const USER = process.env.DEMO_USER ?? "demo-owner";
export const TAG = "E2E-DEPLOY";

export function password(): string {
  const p = process.env.DEMO_PW;
  if (!p) throw new Error("DEMO_PW thiếu — chạy qua deploy/prod-sohoptac2/e2e-deployed.ps1");
  return p;
}

/** Đăng nhập một web (contracts-web `/login`, chat-web `/login`): điền mã công ty nếu ô còn hiện. */
export async function login(page: Page, base: string): Promise<void> {
  await page.goto(`${base}/login`);
  const pw = page.locator("input[type=password]").first();
  await pw.waitFor({ timeout: 45_000 });
  const tenant = page.getByRole("textbox", { name: /Mã công ty|Company code/ });
  if (await tenant.count()) await tenant.fill(TENANT);
  await page.getByRole("textbox", { name: /^(Tên đăng nhập|Username|Email)$/ }).fill(USER);
  await pw.fill(password());
  await page.getByRole("button", { name: /^(Đăng nhập|Sign in)$/ }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 45_000 });
}

/** Lỗi console đáng kể (bỏ nhiễu: tài nguyên thiếu favicon/map). */
const NOISE = [/favicon/i, /\.map\b/i, /Download the React DevTools/i];
export type Errs = { list: string[] };
export function watchConsole(page: Page): Errs {
  const errs: Errs = { list: [] };
  const keep = (s: string) => !NOISE.some((r) => r.test(s));
  page.on("console", (m: ConsoleMessage) => {
    if (m.type() === "error" && keep(m.text()))
      errs.list.push(`console: ${m.text().slice(0, 300)}`);
  });
  page.on("pageerror", (e) => errs.list.push(`pageerror: ${String(e.message).slice(0, 300)}`));
  page.on("response", (r) => {
    const u = new URL(r.url());
    if (r.status() >= 500 && keep(u.pathname))
      errs.list.push(`HTTP ${r.status()} ${r.request().method()} ${u.pathname}`);
  });
  return errs;
}

/** Chờ mạng yên (không phải sleep cố định); lỗi ⇒ bỏ qua (SSE/polling giữ kết nối mở). */
export async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
}

export async function bodyText(page: Page): Promise<string> {
  return page.locator("body").innerText();
}

/** Gửi một lượt chat và chờ trả lời xong (nút Dừng biến mất). Trả về toàn bộ chữ của vùng hội thoại. */
export async function chatTurn(page: Page, text: string): Promise<string> {
  const box = page.getByRole("textbox").last();
  await box.fill(text);
  const before = (await bodyText(page)).length;
  await page.keyboard.press("Enter");
  // Tin của mình phải hiện trong hội thoại (Enter bị chặn khi tệp còn đang tải ⇒ không gửi).
  await expect
    .poll(async () => (await bodyText(page)).includes(text.slice(0, 40)), { timeout: 30_000 })
    .toBe(true);
  const stop = page.getByRole("button", { name: /^(Dừng|Stop)/ });
  await stop.waitFor({ state: "visible", timeout: 30_000 }).catch(() => {});
  await stop.waitFor({ state: "detached", timeout: 300_000 }).catch(() => {});
  await expect
    .poll(async () => (await bodyText(page)).length, { timeout: 30_000 })
    .not.toBe(before);
  const after = await bodyText(page);
  if (/ALL_PROVIDERS_EXHAUSTED|AI đang tạm ngưng/.test(after))
    throw new Error(
      "SERVER AI: ALL_PROVIDERS_EXHAUSTED (gói Claude trên sohoptac2 hết lượt/không dùng được) — không phải lỗi giao diện",
    );
  return after;
}

/** Dọn qua API ứng dụng (đăng nhập riêng, không đụng trang): xoá mọi Group gắn thẻ E2E-DEPLOY của tenant demo còn 0 thành viên
 *  (quyền + dấu phòng ban đi theo FK cascade). Lỗi ⇒ nuốt (dọn là cố gắng tốt nhất, không làm đỏ test). Trả số Group đã xoá. */
export async function sweepTaggedGroups(base: string = CW): Promise<number> {
  const api = await playwrightRequest.newContext({ baseURL: base });
  let n = 0;
  try {
    const lr = await api.post("/auth/login", {
      data: { tenant_key: TENANT, username: USER, password: password() },
      headers: { "X-App": "contracts" },
    });
    const token = ((await lr.json()) as { access_token?: string }).access_token;
    if (!token) return 0;
    const headers = { Authorization: `Bearer ${token}` };
    const lst = await api.get(`/admin/groups?limit=200&q=${encodeURIComponent(TAG)}`, { headers });
    const body = (await lst.json()) as {
      items?: { id: string; key: string; member_count: number }[];
    };
    for (const g of body.items ?? []) {
      if (!g.key.toLowerCase().startsWith("e2e-deploy") || g.member_count > 0) continue;
      const r = await api.delete(`/admin/groups/${g.id}`, { headers });
      if (r.status() === 204) n++;
    }
  } catch {
    // dọn là cố gắng tốt nhất
  } finally {
    await api.dispose();
  }
  return n;
}

export const test = base;
export { expect };

export type DifyRunRow = {
  at: string;
  trigger: string;
  status: string;
  error_message: string | null;
};

/** Lịch sử chạy Dify của workflow `key` (platform admin qua Admin API; mật khẩu `ADMIN_PW` do runner nạp, không in). Mới → cũ. */
export async function difyRuns(key: string): Promise<DifyRunRow[]> {
  const pw = process.env.ADMIN_PW;
  if (!pw) throw new Error("ADMIN_PW thiếu — chạy qua deploy/prod-sohoptac2/e2e-deployed.ps1");
  const api = await playwrightRequest.newContext({ baseURL: ADMIN });
  try {
    const lr = await api.post("/auth/login", {
      data: { tenant_key: "platform", username: "admin", password: pw },
      headers: { "X-App": "admin" },
    });
    const token = ((await lr.json()) as { access_token?: string }).access_token;
    if (!token) throw new Error("đăng nhập platform admin thất bại");
    const headers = { Authorization: `Bearer ${token}` };
    const wl = await api.get(`/admin/workflows?q=${encodeURIComponent(key)}&limit=50`, { headers });
    const wf = ((await wl.json()) as { items?: { id: string; key: string }[] }).items?.find(
      (w) => w.key === key,
    );
    if (!wf) throw new Error(`không thấy workflow ${key}`);
    const rr = await api.get(`/admin/workflows/${wf.id}/runs?limit=20`, { headers });
    return ((await rr.json()) as { items?: DifyRunRow[] }).items ?? [];
  } finally {
    await api.dispose();
  }
}
