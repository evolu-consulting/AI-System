// ADM-FR-01 · helper dùng chung cho e2e M1 (chạy trong Node/Playwright: không dùng API riêng của Bun).
import { execFileSync } from "node:child_process";
import { type APIRequestContext, expect, type Page } from "@playwright/test";
import postgres from "postgres";
import { PW } from "../../tests/acceptance/M1/_data";

export { PW, TEMP_PW, TENANT_ID, USER_ID } from "../../tests/acceptance/M1/_data";
export { ID, LEAK_1, LEAK_2, LEAK_EMOJI, leakForms } from "../../tests/acceptance/M2/_data";
export { betaId, ID3, id3 } from "../../tests/acceptance/M3/_data";

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

/** Đăng nhập một user fixture (mật khẩu `PW` của M1 §3) vào khung quản trị, vd `loginAs(page, "acme", "binh")`. */
export async function loginAs(page: Page, tenant: string, username: string) {
  await loginToShell(page, tenant, username, PW);
}

/** Đăng nhập platform_admin seed vào khung quản trị. */
export async function loginAdmin(page: Page) {
  const a = seedAdmin();
  await loginToShell(page, "platform", a.username, a.password);
}

/** Điều hướng bằng URL đầy đủ (reload) rồi chờ heading level 1 của màn đích; không race điều hướng. */
export async function openPage(page: Page, path: string, heading: string) {
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
}

export type Traffic = {
  /** Chờ mọi body response đã đọc xong rồi mới quét (không race). */
  flush: () => Promise<void>;
  bodies: string[];
  requests: Array<{ url: string; method: string; post: string | null }>;
  consoleMessages: string[];
};

/** Thu mọi request/response/console của trang để quét rò secret (AC-A06). Gọi TRƯỚC khi thao tác. */
export function collectTraffic(page: Page): Traffic {
  const pending: Promise<void>[] = [];
  const t: Traffic = {
    flush: async () => {
      await Promise.all(pending);
    },
    bodies: [],
    requests: [],
    consoleMessages: [],
  };
  page.on("request", (r) =>
    t.requests.push({ url: r.url(), method: r.method(), post: r.postData() }),
  );
  page.on("response", (r) => {
    pending.push(
      r
        .text()
        .then((b) => {
          t.bodies.push(b);
        })
        .catch(() => undefined),
    );
  });
  page.on("console", (m) => t.consoleMessages.push(m.text()));
  return t;
}

/** Mọi nơi trên trang + mạng có thể chứa `forms`; trả danh sách nơi bị lộ (rỗng = sạch). */
export async function leaksOnPage(page: Page, t: Traffic, forms: string[]): Promise<string[]> {
  await t.flush();
  // Chuỗi JS (không phải hàm) vì tsconfig của test không có lib DOM; chạy trong trình duyệt.
  const storage = String(
    await page.evaluate(
      `JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage }, cookie: document.cookie,
        title: document.title, url: location.href, state: JSON.stringify(history.state ?? null) })`,
    ),
  );
  const where: Record<string, string> = {
    html: await page.content(),
    storage,
    console: t.consoleMessages.join("\n"),
    responses: t.bodies.join("\n"),
    // Body request chỉ được chứa giá trị ở đúng POST/PUT /admin/secrets (ghi giá trị).
    otherRequests: t.requests
      .filter((r) => !(/\/admin\/secrets/.test(r.url) && ["POST", "PUT"].includes(r.method)))
      .map((r) => `${r.url}\n${r.post ?? ""}`)
      .join("\n"),
  };
  return Object.entries(where)
    .filter(([, text]) => forms.some((f) => text.includes(f)))
    .map(([k]) => k);
}

/** Toast (role status) có chứa `text`. */
export const toast = (page: Page, text: string | RegExp) =>
  page.getByRole("status").filter({ hasText: text });

const API_URL = "http://localhost:3001";

/** Gọi thẳng admin-api (cổng 3001) bằng token platform_admin seed — để dựng thay đổi "từ phía khác" (tab 2). */
export async function apiAsAdmin(request: APIRequestContext) {
  const a = seedAdmin();
  const login = await request.post(`${API_URL}/auth/login`, {
    data: { tenant_key: "platform", username: a.username, password: a.password },
  });
  expect(login.status()).toBe(200);
  const token = ((await login.json()) as { access_token: string }).access_token;
  const headers = { authorization: `Bearer ${token}` };
  return {
    post: (path: string, data: unknown) => request.post(`${API_URL}${path}`, { headers, data }),
    get: (path: string) => request.get(`${API_URL}${path}`, { headers }),
    patch: (path: string, data: unknown) => request.patch(`${API_URL}${path}`, { headers, data }),
    put: (path: string, data?: unknown) => request.put(`${API_URL}${path}`, { headers, data }),
    del: (path: string) => request.delete(`${API_URL}${path}`, { headers }),
  };
}
