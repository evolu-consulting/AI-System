// e2e-journey-approval · bước dùng chung của hành trình duyệt HĐ (stack `approval.ja.ts` và triển khai `deployed/21-*`): đăng nhập hai web,
// platform admin gán quy trình + luật ở ai-admin, nhân viên tải HĐ, người duyệt bấm Đạt. Chỉ thao tác như người dùng thật (UI).
import { expect, type Locator, type Page, type Response } from "@playwright/test";
import {
  apiLogin,
  assignProcess,
  libraryDefIdByName,
  type Session,
  setRoutingRules,
  tenantIdByKey,
} from "../_kit/api";
import { loginPlatformAdminUi, openCompanyFlows, openTenantAppsTab, safeReload } from "../_kit/ui";
import { withOwner } from "../support/helpers";
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

const need = (n: string): string => {
  const v = process.env[n];
  if (!v) throw new Error(`${n} chưa đặt (playwright.journey.config.ts)`);
  return v;
};
async function platformSession(e: Env): Promise<{ s: Session; tenantId: string }> {
  const api = need("JA_API_URL");
  const s = await apiLogin({
    base: api,
    tenantKey: "platform",
    username: e.adminUser,
    password: e.adminPw,
  });
  return { s, tenantId: await tenantIdByKey(api, s, e.tenantKey) };
}

/**
 * CR-122 U2: màn "Việc" + "Luật định tuyến" + ngăn Gán đã gỡ — tab "Quy trình" của công ty chỉ còn MỘT danh sách flow
 * (`company-flows`). Mở công ty › tab Quy trình, trả hộp danh sách.
 */
export async function openProcessPanel(page: Page): Promise<Locator> {
  return openCompanyFlows(page);
}

/**
 * Gán quy trình thư viện `defName` cho công ty bằng API (đường khe cũ, cờ FLOW_TRIGGERS tắt) — UI gán theo khe đã gỡ ở CR-122.
 * Gán bằng giao diện mới (danh sách flow) được kiểm ở `cr122-flows.spec.ts`.
 */
export async function apiAssignDef(e: Env, defName: string): Promise<string> {
  const { s, tenantId } = await platformSession(e);
  const hub = need("JA_HUB_URL");
  const defId = await libraryDefIdByName(hub, s, defName);
  await assignProcess(hub, s, tenantId, SLOT, defId);
  return defId;
}

/** Platform admin: gán 2 quy trình cho công ty + 2 luật (Phòng Kinh doanh × Mua/Bán) bằng API. Chạy lại được (PUT thay cả danh sách). */
export async function adminAssignAndRoute(_page: Page, e: Env): Promise<void> {
  const { s, tenantId } = await platformSession(e);
  const hub = need("JA_HUB_URL");
  const kd = await withOwner(
    (sql) =>
      sql<
        { id: string }[]
      >`select id::text from admin.groups where tenant_id = ${tenantId} and key = 'pb-kinh-doanh'`,
  );
  const dept = kd[0]?.id;
  if (!dept) throw new Error("công ty chưa có phòng pb-kinh-doanh");
  const ids = {
    buy: await apiAssignDef(e, PROC.buy),
    sell: await apiAssignDef(e, PROC.sell),
  };
  await setRoutingRules(hub, s, tenantId, SLOT, [
    { condition: { departmentIds: [dept], contractKinds: ["buy"] }, def_id: ids.buy },
    { condition: { departmentIds: [dept], contractKinds: ["sell"] }, def_id: ids.sell },
  ]);
}

/** Khối Quy trình của công ty (tab Quy trình). */
export async function openProcessBlock(page: Page, e: Env): Promise<Locator> {
  await openTenantAppsTab(page, e.tenantName);
  return openCompanyFlows(page);
}

/** Nhân viên tải HĐ mẫu lên bằng UI; chờ AI đọc xong (có nút "Xác nhận và lưu"). Trả id HĐ. */
export async function uploadAndOpen(
  page: Page,
  e: Env,
  run: string,
  total?: number,
): Promise<string> {
  const doc = buyContract(run, total);
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
  // Nút xác nhận hiện sớm (P11d): chờ AI điền xong Tên + Nhà cung cấp (ô bắt buộc) rồi mới xác nhận, tránh bấm khi form còn trống.
  await expect(page.getByRole("textbox", { name: /^Tên hợp đồng/ })).not.toHaveValue("", {
    timeout: 120_000,
  });
  await expect(page.getByRole("textbox", { name: /^Nhà cung cấp/ })).not.toHaveValue("", {
    timeout: 60_000,
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
