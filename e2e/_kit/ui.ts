// e2e/_kit · helper cấp giao diện dùng chung (Playwright): đăng nhập platform admin, mở tab "Ứng dụng & Gói" của công ty,
// gán quy trình ở khối Quy trình, tải lại trang an toàn (chờ `/auth/refresh` đang bay + app khởi động).
import { expect, type Locator, type Page, type Response } from "@playwright/test";

/** Đăng nhập ai-admin (admin-web) bằng platform admin qua trang /login; chờ tiêu đề "Tổng quan". */
export async function loginPlatformAdminUi(
  page: Page,
  adminUrl: string,
  username: string,
  password: string,
): Promise<void> {
  await page.goto(`${adminUrl}/login`);
  await page.getByRole("textbox", { name: "Mã công ty" }).fill("platform");
  await page.getByRole("textbox", { name: "Tên đăng nhập" }).fill(username);
  await page.getByLabel("Mật khẩu", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Tổng quan" })).toBeVisible();
}

/**
 * CR-121 c10 · từ ai-admin đã đăng nhập: mở trang chi tiết công ty `tenantName` đi đường người dùng đi
 * (menu "Công ty" → tìm → bấm hàng → "Mở trang chi tiết"); thanh bên không còn danh sách công ty.
 */
export async function openTenantPage(page: Page, tenantName: string | RegExp): Promise<void> {
  const name = typeof tenantName === "string" ? new RegExp(tenantName) : tenantName;
  await page.goto(`${new URL(page.url()).origin}/tenants`); // = menu "Công ty"
  await expect(page.getByRole("table", { name: "Công ty" })).toBeVisible();
  const q = typeof tenantName === "string" ? tenantName : tenantName.source.replace(/\\/g, "");
  await page.getByRole("searchbox").first().fill(q);
  await page.getByRole("row", { name }).first().click();
  await page.getByRole("dialog").getByRole("link", { name: "Mở trang chi tiết" }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
}

/** Như `openTenantPage` rồi sang tab "Ứng dụng". */
export async function openTenantAppsTab(page: Page, tenantName: string | RegExp): Promise<void> {
  await openTenantPage(page, tenantName);
  await page.getByRole("tab", { name: "Ứng dụng" }).click();
}
/**
 * CR-121 c11 · mở công ty › tab "Quy trình" rồi ngăn chi tiết của việc `slot` (nơi DUY NHẤT gán quy trình).
 * Trả hộp `admin-assigned-<slot>` của ngăn Gán (platform_admin) để dùng với `assignProcessUi`.
 */
export async function openJobDrawer(page: Page, slot: string): Promise<Locator> {
  await page.getByRole("tab", { name: "Quy trình" }).click();
  await page.getByTestId(`flows-open-${slot}`).click();
  const box = page.getByTestId(`flows-assign-panel-${slot}`).getByTestId(`admin-assigned-${slot}`);
  await expect(box).toBeVisible();
  return box;
}
/** Giá trị `value` của lựa chọn có chữ `text` trong `<select>` (ném lỗi rõ nếu không có). */
export async function optionValue(select: Locator, text: string): Promise<string> {
  const v = await select.locator("option", { hasText: text }).first().getAttribute("value");
  if (!v) throw new Error(`không có lựa chọn "${text}"`);
  return v;
}

/**
 * Gán quy trình thư viện vào hộp khe `admin-assigned-<slot>` (`box`) bằng UI. `name` vắng ⇒ lấy quy trình đầu tiên của thư viện.
 * Chạy lại được: đã gán đủ thì bỏ qua. Trả sau khi quy trình hiện trong danh sách đã gán.
 */
export async function assignProcessUi(box: Locator, name?: string): Promise<void> {
  const assignedRows = box.getByTestId(/^admin-assigned-[0-9a-f-]{36}$/);
  if (
    name
      ? (await assignedRows.filter({ hasText: name }).count()) > 0
      : (await assignedRows.count()) > 0
  )
    return;
  const pick = box.getByTestId("admin-assign-pick");
  const value = name
    ? await optionValue(pick, name)
    : await pick.locator("option[value]:not([value=''])").first().getAttribute("value");
  if (!value) throw new Error("thư viện không có quy trình nào để gán");
  await pick.selectOption(value);
  await box.getByTestId("admin-assign-add").click();
  await expect(name ? assignedRows.filter({ hasText: name }) : assignedRows).toHaveCount(1);
}

// ── tải lại an toàn ────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Mỗi lần tải trang SPA tự `POST /auth/refresh` (xoay token). Tải lại khi lượt refresh trước CHƯA xong ⇒ phản hồi (Set-Cookie) bị huỷ,
// token cũ bị coi là "đã xoay" ⇒ 401 ⇒ về trang đăng nhập (lỗi của test). Nên chờ refresh xong + app khởi động trước khi tải lại.
const inflight = new WeakMap<Page, Set<unknown>>();

/** Bắt đầu theo dõi `/auth/refresh` của trang (gọi tự động bởi `safeReload`; gọi sớm hơn nếu muốn bắt cả lượt refresh đầu). */
export function trackRefresh(page: Page): Set<unknown> {
  let set = inflight.get(page);
  if (set) return set;
  set = new Set<unknown>();
  inflight.set(page, set);
  const live = set;
  const isRefresh = (u: string) => u.includes("/auth/refresh");
  page.on("request", (r) => {
    if (isRefresh(r.url())) live.add(r);
  });
  page.on("requestfinished", (r) => void live.delete(r));
  page.on("requestfailed", (r) => void live.delete(r));
  return live;
}

export type SafeReloadOpts = {
  /** Phản hồi "app đã khởi động" cần chờ SAU khi tải lại (vd GET dữ liệu chính của trang). */
  boot?: (r: Response) => boolean;
  /** Điều kiện sẵn sàng sau khi tải lại (vd Locator hiện). */
  ready?: Locator;
  timeout?: number;
};

/**
 * Tải lại trang mà không làm hỏng phiên: chờ `/auth/refresh` đang bay xong + mạng yên, tải lại, rồi chờ `boot`/`ready` (nếu có).
 * Ví dụ: `await safeReload(page, { boot: (r) => r.url().includes("/approval"), ready: page.getByTestId("approval-step-0") })`.
 */
export async function safeReload(page: Page, opts: SafeReloadOpts = {}): Promise<void> {
  const timeout = opts.timeout ?? 30_000;
  const live = trackRefresh(page);
  await expect.poll(() => live.size, { timeout }).toBe(0);
  await page.waitForLoadState("networkidle", { timeout }).catch(() => undefined);
  const booted = opts.boot ? page.waitForResponse(opts.boot, { timeout }) : undefined;
  await page.reload();
  await booted;
  // refresh do lần tải này khởi động cũng phải xong trước khi caller có thể tải lại tiếp
  await expect.poll(() => live.size, { timeout }).toBe(0);
  if (opts.ready) await expect(opts.ready).toBeVisible({ timeout });
}
