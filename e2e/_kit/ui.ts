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

/** Quản trị CÔNG TY đăng nhập ai-admin (admin-web) bằng mã công ty + tên đăng nhập; chờ tiêu đề "Tổng quan". */
export async function loginTenantAdminUi(
  page: Page,
  adminUrl: string,
  tenantKey: string,
  username: string,
  password: string,
): Promise<void> {
  await page.goto(`${adminUrl}/login`);
  await page.getByRole("textbox", { name: "Mã công ty" }).fill(tenantKey);
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
 * CR-122 U2 · công ty › tab "Quy trình" = MỘT danh sách flow (`company_flows`; thay "việc → luật → ngăn Gán" của CR-121).
 * Mở tab, trả hộp `company-flows`. Dòng flow: `flowRows(box)`; dòng theo tên: `flowRow(box, name)`.
 */
export async function openCompanyFlows(page: Page): Promise<Locator> {
  await page.getByRole("tab", { name: "Quy trình" }).click();
  const box = page.getByTestId("company-flows");
  await expect(box).toBeVisible();
  return box;
}
export const flowRows = (box: Locator): Locator => box.locator('li[data-testid^="company-flow-"]');
export const flowRow = (box: Locator, name: string): Locator =>
  flowRows(box).filter({ hasText: name });
/**
 * CR-127 · quản trị nền tảng bấm «Tạo quy trình» ở trang Quy trình (công ty → [ứng dụng] → tên → «Tạo và mở sơ đồ»), chờ màn soạn mở. Trả id quy trình.
 * `app` (tên hiển thị, vd "Community") chỉ cần khi công ty bật từ hai ứng dụng có quy trình trở lên (ô «Quy trình cho»); vắng ⇒ ứng dụng đầu (Sổ Hợp Tác).
 */
export async function createFlowUi(
  page: Page,
  adminUrl: string,
  o: { company: string; name: string; app?: string },
): Promise<string> {
  await page.goto(`${adminUrl}/processes`);
  await page.getByTestId("create-flow-open").click();
  const dlg = page.getByTestId("create-flow-dialog");
  await dlg.getByRole("combobox").first().click();
  await page.getByRole("option", { name: o.company, exact: true }).click();
  await expect(dlg.getByTestId("create-flow-summary")).toBeVisible();
  if (o.app) {
    await dlg.getByRole("combobox", { name: "Quy trình cho" }).click();
    await page.getByRole("option", { name: o.app, exact: true }).click();
  }
  await dlg.getByRole("textbox", { name: "Tên quy trình" }).fill(o.name);
  await dlg.getByRole("button", { name: "Tạo và mở sơ đồ" }).click();
  await expect(page).toHaveURL(/\/processes\/[0-9a-f-]{36}/);
  await expect(page.getByTestId("outline-editor")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("outline-done")).toBeVisible();
  return /\/processes\/([0-9a-f-]{36})/.exec(page.url())?.[1] ?? "";
}

/**
 * CR-127 · mở màn soạn quy trình (vẽ theo khối) của một quy trình công ty: `/processes/:flowId?company=:tenantId`; chờ khối «Bắt đầu» và «Hoàn tất» hiện.
 * Chỉ quản trị nền tảng soạn được; quản trị công ty chỉ xem (tab Quy trình + `company-flow-readonly-note`).
 */
export async function openFlowEditor(
  page: Page,
  adminUrl: string,
  tenantId: string,
  flowId: string,
): Promise<void> {
  await page.goto(`${adminUrl}/processes/${flowId}?company=${tenantId}`);
  await expect(page.getByTestId("outline-editor")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("outline-done")).toBeVisible({ timeout: 30_000 });
}

/** CR-127 · màn soạn theo khối: «+» thứ `index` trên đường chính → mục menu `item` (testid `flow-node-<id>` hoặc tên). */
export async function addMainStep(page: Page, index: number, item: string | RegExp): Promise<void> {
  await page.getByTestId(`outline-add-main-${index}`).click();
  if (typeof item === "string") await page.getByTestId(`flow-node-${item}`).click();
  else await page.getByRole("menuitem", { name: item }).click();
}

/** CR-127 · chọn người duyệt (ô «Ai duyệt» đầu tiên của panel bước) theo tên phòng/người. */
export async function pickApprover(page: Page, who: RegExp | string): Promise<void> {
  await page
    .getByRole("combobox", { name: /Ai duyệt/ })
    .first()
    .click();
  await page.getByRole("option", { name: who }).first().click();
}

/** Giá trị `value` của lựa chọn có chữ `text` trong `<select>` (ném lỗi rõ nếu không có). */
export async function optionValue(select: Locator, text: string): Promise<string> {
  const v = await select.locator("option", { hasText: text }).first().getAttribute("value");
  if (!v) throw new Error(`không có lựa chọn "${text}"`);
  return v;
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
