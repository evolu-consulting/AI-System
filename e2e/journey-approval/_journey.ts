// e2e-journey-approval · bước dùng chung của hành trình duyệt HĐ (stack `approval.ja.ts` và triển khai `deployed/21-*`): đăng nhập hai web,
// platform admin gán quy trình + luật + bật engine ở ai-admin, nhân viên tải HĐ, người duyệt bấm Đạt. Chỉ thao tác như người dùng thật (UI).
import { expect, type Locator, type Page, type Response } from "@playwright/test";
import { loginPlatformAdminUi, openTenantAppsTab, optionValue, safeReload } from "../_kit/ui";
import { buyContract } from "./_fixture";

export type Env = {
  cw: string;
  admin: string;
  tenantKey: string;
  tenantName: string;
  /** Mật khẩu chung của các tài khoản hành trình. */
  pw: string;
  adminUser: string;
  adminPw: string;
};

export const U = {
  employee: "e2e-kd-nv",
  accounting: "e2e-ketoan",
  director: "e2e-giamdoc",
} as const;
export const PROC = { buy: "E2E Mua (Kinh doanh)", sell: "E2E Bán (Kinh doanh)" } as const;
export const SLOT = "contracts.approval";
const UUID = /\/contracts\/c\/([0-9a-f-]{36})/;
const toast = (page: Page, text: string): Locator => page.getByText(text, { exact: false }).first();

/** Đăng nhập Sổ Hợp Tác (workspace-web) bằng trang /login. */
export async function loginCw(page: Page, e: Env, user: string): Promise<void> {
  await page.goto(`${e.cw}/login`);
  const tenant = page.getByRole("textbox", { name: "Mã công ty" });
  const change = page.getByRole("button", { name: "Đổi công ty" });
  await expect(tenant.or(change)).toBeVisible();
  if (!(await tenant.isVisible())) await change.click();
  await tenant.fill(e.tenantKey);
  await page.getByRole("textbox", { name: "Email" }).fill(user);
  await page.getByLabel("Mật khẩu", { exact: true }).fill(e.pw);
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

/** Đăng nhập ai-admin (admin-web) bằng platform admin. */
export async function loginAdmin(page: Page, e: Env): Promise<void> {
  await loginPlatformAdminUi(page, e.admin, e.adminUser, e.adminPw);
}

/** Mở trang công ty › tab "Ứng dụng & Gói"; trả thẻ Sổ Hợp Tác. */
async function openContractsCard(page: Page, e: Env): Promise<Locator> {
  await openTenantAppsTab(page, e.tenantName);
  const card = page.getByRole("region", { name: /Sổ Hợp Tác|Hợp đồng/ }).first();
  await expect(card).toBeVisible();
  return card;
}

/** CR-120: khối Quy trình duy nhất của thẻ app (công tắc Duyệt theo quy trình + quy trình đã gán + luật), luôn mở. */
export const processBlock = (card: Locator): Locator =>
  card.getByTestId("tenant-processes-contracts");

/** Platform admin: gán 2 quy trình cho công ty + 2 luật (Phòng Kinh doanh × Mua/Bán). Chạy lại được (đã đủ thì bỏ qua). */
export async function adminAssignAndRoute(page: Page, e: Env): Promise<void> {
  const card = await openContractsCard(page, e);
  const slots = processBlock(card);
  const box = slots.getByTestId(`admin-assigned-${SLOT}`);
  for (const name of [PROC.buy, PROC.sell]) {
    const assigned = box.getByTestId(/^admin-assigned-[0-9a-f-]{36}$/).filter({ hasText: name });
    if ((await assigned.count()) > 0) continue;
    const pick = box.getByTestId("admin-assign-pick");
    await pick.selectOption(await optionValue(pick, name));
    await box.getByTestId("admin-assign-add").click();
    await expect(toast(page, "Đã gán quy trình")).toBeVisible();
    await expect(
      box.getByTestId(/^admin-assigned-[0-9a-f-]{36}$/).filter({ hasText: name }),
    ).toHaveCount(1);
  }
  const want = [
    { process: PROC.buy, kind: "buy" },
    { process: PROC.sell, kind: "sell" },
  ];
  const rules = box.getByTestId(/^admin-routing-rule-\d+$/);
  const base = await rules.count(); // CR-120: dòng "Mặc định" của quy trình đang dùng đã có sẵn ở đầu danh sách
  const done = await box
    .getByTestId(/^admin-routing-rule-\d+-kind-buy$/)
    .evaluateAll((els) => els.filter((e) => (e as HTMLInputElement).checked).length);
  if (done > 0) return; // luật Mua đã đặt (chạy lại)
  for (const [j, w] of want.entries()) {
    const i = base + j;
    await box.getByTestId("admin-routing-add").click();
    const row = box.getByTestId(`admin-routing-rule-${i}`);
    const sel = row.getByTestId(`admin-routing-rule-${i}-process`);
    await sel.selectOption(await optionValue(sel, w.process));
    await row.getByRole("checkbox", { name: "Phòng Kinh doanh" }).check();
    await row.getByTestId(`admin-routing-rule-${i}-kind-${w.kind}`).check();
  }
  await box.getByTestId("admin-routing-save").click();
  await expect(toast(page, "Đã lưu luật chọn quy trình")).toBeVisible();
}

/** Khối Quy trình của công ty (sau khi mở trang công ty › Ứng dụng & Gói). */
export async function openProcessBlock(page: Page, e: Env): Promise<Locator> {
  return processBlock(await openContractsCard(page, e));
}

/** Platform admin bật/tắt công tắc "Duyệt theo quy trình" trong khối Quy trình (lưu một lượt). */
export async function adminSetEngine(page: Page, e: Env, on: boolean): Promise<void> {
  const card = await openContractsCard(page, e);
  const sw = processBlock(card).getByTestId("tenant-engine-switch");
  await expect(sw).toBeVisible();
  if (await sw.isDisabled()) {
    // ứng dụng đang Tắt ⇒ công tắc khoá: chọn mức Quản trị trước (thao tác thật của admin)
    await card.getByRole("radio", { name: "Quản trị" }).click();
  }
  if ((await sw.isChecked()) === on) return;
  await sw.click();
  await page.getByRole("button", { name: "Lưu", exact: true }).click();
  await expect(toast(page, "Đã lưu tính năng cho")).toBeVisible();
  // đọc lại từ máy chủ: công tắc phải đúng
  await safeReload(page);
  await page.getByRole("tab", { name: "Ứng dụng" }).click();
  await expect(
    processBlock(page.getByRole("region", { name: /Sổ Hợp Tác|Hợp đồng/ }).first()).getByTestId(
      "tenant-engine-switch",
    ),
  ).toBeChecked({ checked: on });
}
/** Nhân viên tải HĐ mẫu lên bằng UI; chờ AI đọc xong (có nút "Xác nhận và lưu"). Trả id HĐ. */
export async function uploadAndOpen(page: Page, e: Env, run: string): Promise<string> {
  const doc = buyContract(run);
  await page.goto(`${e.cw}/contracts/list`);
  await page.locator('input[type="file"]').setInputFiles({
    name: `hop-dong-mua-${run}.md`,
    mimeType: "text/markdown",
    buffer: Buffer.from(doc.text, "utf8"),
  });
  await page.getByTestId("upload-confirm").click();
  await page.waitForURL(UUID, { timeout: 60_000 });
  const id = UUID.exec(page.url())?.[1] ?? "";
  expect(id).not.toBe("");
  await expect(page.getByRole("button", { name: "Xác nhận và lưu" })).toBeVisible({
    timeout: 120_000,
  });
  return id;
}

export const stepOf = (page: Page, name: string): Locator =>
  page.getByTestId(/^approval-step-\d+$/).filter({ hasText: name });

/** Người duyệt mở HĐ, thấy bước `stepName` đang mở + nút Đạt, bấm Đạt; bước đó thành "passed". */
export async function approveAs(
  page: Page,
  e: Env,
  user: string,
  id: string,
  stepName: string,
): Promise<void> {
  await loginCw(page, e, user);
  // Tải lại an toàn (kit): chờ `/auth/refresh` đang bay + thẻ duyệt đã trả về trước khi tải lại (xem e2e/_kit/ui.ts).
  const isApproval = (r: Response) =>
    r.request().method() === "GET" && r.url().includes(`/contracts/${id}/approval`);
  const loaded = () => page.waitForResponse(isApproval, { timeout: 30_000 });
  const first = loaded();
  await page.goto(`${e.cw}/contracts/c/${id}`);
  await first;
  const btn = page.locator("[data-approval=pass], [data-approval=approve]").first();
  let n = 0;
  await expect(async () => {
    if (n++ > 0) {
      await safeReload(page, { boot: isApproval });
    }
    await expect(stepOf(page, stepName)).toHaveAttribute("data-status", "open", { timeout: 4_000 });
    await expect(btn).toBeVisible({ timeout: 4_000 });
  }).toPass({ timeout: 60_000 });
  await btn.click();
  await expect(stepOf(page, stepName)).toHaveAttribute("data-status", "passed");
}
