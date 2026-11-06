// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: biến e2e/test, không ảnh hưởng cache build
// CR-121 c11 (D5, R4) · HÀNH TRÌNH Công ty › Quy trình trên stack thật, KHÔNG seed bật sẵn gì: công ty MỚI (hậu tố duy nhất), chưa gán quy trình.
// 1) platform_admin: tab Quy trình ⇒ việc "Duyệt hợp đồng" Đang tắt · chưa gán quy trình ⇒ ngăn ⇒ Gán một quy trình thư viện (chỉ liệt kê cùng loại)
//    ⇒ Đang bật ngay (không công tắc nào khác); canvas là chế độ xem mặc định, đổi sang danh sách thì nhớ sau khi tải lại.
// 2) tenant_admin công ty đó: Xem bản thư viện chỉ xem ⇒ "Sao chép cho công ty này" (tự gán thay bản cũ) ⇒ "Mở trình sửa" ⇒ Đổi về bản cũ.
// Cần stack hành trình (playwright.journey.config.ts: JA_* env, quy trình thư viện `e2e-mua-kd`). VIẾT, CHƯA CHẠY (luật 5d; điều phối chạy cuối đợt).
import { expect, test } from "@playwright/test";
import { apiLogin, cloneAndPublishFlow, createIsolatedTenant, type Session } from "../_kit/api";
import { loginPlatformAdminUi } from "../_kit/ui";
import { uniqueSuffix } from "../_kit/unique";

const need = (n: string): string => {
  const v = process.env[n];
  if (!v) throw new Error(`${n} chưa đặt (playwright.journey.config.ts)`);
  return v;
};
const ADMIN_URL = need("JA_ADMIN_URL");
const API = need("JA_API_URL");
const HUB = need("JA_HUB_URL");
const SLOT = "contracts.approval";
const SFX = uniqueSuffix();
const FLOW = `E2E C11 Duyệt ${SFX}`;
let company = { id: "", key: "", name: "", adminUser: "", adminPw: "" };
let platform: Session;

test.describe.configure({ mode: "serial" });

/** Ngăn chi tiết của việc đã mở (sau Esc có thể đã đóng) thì giữ nguyên, chưa mở thì bấm tên việc. */
async function openJob(page: import("@playwright/test").Page): Promise<void> {
  if (!(await page.getByTestId("flows-view-canvas").isVisible()))
    await page.getByTestId(`flows-open-${SLOT}`).click();
}

test.beforeAll(async () => {
  platform = await apiLogin({
    base: API,
    tenantKey: "platform",
    username: need("SEED_ADMIN_USERNAME"),
    password: need("SEED_ADMIN_PASSWORD"),
  });
  const t = await createIsolatedTenant(API, platform, "c11");
  const j = t.json as { tenant: { id: string }; temp_password?: string };
  company = {
    id: j.tenant.id,
    key: t.key,
    name: t.name,
    adminUser: `${t.key}-admin`,
    adminPw: j.temp_password ?? "",
  };
  // Quy trình thư viện RIÊNG của spec (nhân bản + xuất bản), không dùng/ẩn dữ liệu mẫu.
  await cloneAndPublishFlow(HUB, platform, {
    fromKey: "e2e-mua-kd",
    key: `e2e-c11-${SFX}`,
    name: FLOW,
  });
});

test("1 · platform_admin gán từ đầu: Đang tắt · chưa gán ⇒ Gán ⇒ Đang bật; canvas mặc định, danh sách được nhớ", async ({
  page,
}) => {
  await loginPlatformAdminUi(
    page,
    ADMIN_URL,
    need("SEED_ADMIN_USERNAME"),
    need("SEED_ADMIN_PASSWORD"),
  );
  await page.goto(`${ADMIN_URL}/tenants/${company.id}?tab=processes`);
  const status = page.getByTestId(`flows-status-${SLOT}`);
  // công ty mới chưa có luật gán: việc chạy theo mẫu mặc định của khe (không bật tay gì), chưa có quy trình riêng
  await expect(page.getByTestId(`flows-job-${SLOT}`)).not.toContainText(FLOW);

  await page.getByTestId(`flows-assign-${SLOT}`).click();
  const panel = page.getByTestId(`flows-assign-panel-${SLOT}`);
  await expect(panel).toContainText("Chỉ gồm quy trình cùng loại");
  const pick = panel.getByTestId("admin-assign-pick");
  const value = await pick.locator("option", { hasText: FLOW }).first().getAttribute("value");
  if (!value) throw new Error("quy trình thư viện vừa xuất bản không có trong ngăn Gán");
  await pick.selectOption(value);
  await panel.getByTestId("admin-assign-add").click();
  await page.keyboard.press("Escape");
  // gán xong là chạy: không công tắc nào khác
  await expect(status).toContainText("Đang bật");
  await expect(page.getByTestId("tenant-summary")).toContainText("việc có quy trình"); // c14: dòng đầu trang

  // Q11: sơ đồ (canvas) mặc định; chọn danh sách bước ⇒ nhớ sau khi tải lại.
  await openJob(page);
  await expect(page.getByTestId("flows-view-canvas")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("flows-view-list").click();
  await page.reload();
  await openJob(page);
  await expect(page.getByTestId("flows-view-list")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("flows-view-canvas").click(); // trả mặc định cho các spec sau
});

test("2 · tenant_admin công ty mình: bản thư viện chỉ xem ⇒ Sao chép cho công ty này (tự gán) ⇒ Mở trình sửa", async ({
  page,
}) => {
  test.skip(
    !company.adminPw,
    "không đọc được mật khẩu tạm của quản trị đầu tiên từ phản hồi tạo công ty",
  );
  await page.goto(`${ADMIN_URL}/login`);
  await page.getByRole("textbox", { name: "Mã công ty" }).fill(company.key);
  await page.getByRole("textbox", { name: "Tên đăng nhập" }).fill(company.adminUser);
  await page.getByLabel("Mật khẩu", { exact: true }).fill(company.adminPw);
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  // mật khẩu tạm ⇒ phải đặt mật khẩu mới trước khi vào khung (M1-AC06)
  await expect(page).toHaveURL(/\/change-password/);
  const fresh = `Mk-${SFX}-9x`;
  await page.getByLabel("Mật khẩu mới", { exact: true }).fill(fresh);
  await page.getByLabel("Nhập lại mật khẩu mới", { exact: true }).fill(fresh);
  await page.getByRole("button", { name: "Đặt mật khẩu và tiếp tục" }).click();
  await expect(page).not.toHaveURL(/\/change-password/);
  await page.goto(`${ADMIN_URL}/tenants/${company.id}?tab=processes`);
  await expect(page.getByTestId(`flows-status-${SLOT}`)).toContainText("Đang bật");

  await page.getByTestId(`flows-open-${SLOT}`).click();
  await expect(page.getByTestId("flows-library-readonly")).toBeVisible(); // thư viện: chỉ xem
  await expect(page.getByTestId("flows-open-editor")).toHaveCount(0);
  await page.getByTestId("flows-copy").click();
  await expect(page.getByText("Đã sao chép")).toBeVisible();
  // tự gán thay bản cũ: vẫn Đang bật, nay có bản riêng để sửa
  await expect(page.getByTestId(`flows-status-${SLOT}`)).toContainText("Đang bật");
  await expect(page.getByTestId("flows-open-editor")).toBeVisible();
  await expect(page.getByTestId("flows-copy")).toHaveCount(0);

  // Đổi: quay lại bản thư viện trong tập quy trình của công ty (tenant_admin đổi mặc định).
  const candidates = page.getByTestId(/^flows-use-/);
  await expect(candidates).toHaveCount(1);
  await candidates.first().click();
  await expect(page.getByText("Đã đổi quy trình")).toBeVisible();
});
