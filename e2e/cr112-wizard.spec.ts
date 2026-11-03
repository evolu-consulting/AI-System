// CR-112 S7 · ADM-FR-79 · ADM-FR-77 AC4 · wizard thêm công ty 4 bước (không giao dịch xuyên bước, tiếp được, bỏ qua bước 3/4, "Onboard lại"),
// tab Tổng quan, và tab Quota rút gọn của tenant_admin. Gói `contracts` giả bằng support/fake-packs.ts (DB e2e gốc không chạy migration gói).
import { expect, type Page, test } from "@playwright/test";
import { fakePacks } from "./support/fake-packs";
import {
  insertUsage,
  loginAdmin,
  loginAs,
  resetFixture,
  setQuota,
  TENANT_ID,
  toast,
  withOwner,
} from "./support/helpers";

test.describe.configure({ mode: "serial" });

const KEYS = ["contracts-read", "contracts-write", "contracts-admin"];
const ANY_ID = "[0-9a-f-]{36}";

test.beforeAll(async () => {
  resetFixture();
  await withOwner(async (sql) => {
    for (const key of KEYS) {
      await sql`insert into admin.features (key, name, status)
        values (${key}, ${sql.json({ vi: key })}, 'on') on conflict (key) do nothing`;
    }
  });
});
test.afterAll(() => resetFixture());

/** Server thật bật gói `?level=L` ⇒ cấp entitlement mức tới L cho công ty `wizco` (công ty tạo trong ca), tắt ⇒ thu hồi. */
const syncWizco = (key: string, on: boolean, level: "read" | "write" | "admin") =>
  withOwner(async (sql) => {
    if (key !== "contracts" || !on) return;
    const upTo = KEYS.slice(0, ["read", "write", "admin"].indexOf(level) + 1);
    await sql`insert into admin.feature_entitlements (feature_id, tenant_id)
      select f.id, t.id from admin.features f, admin.tenants t
      where f.key = any(${upTo}) and t.key = 'wizco'
      on conflict (feature_id, tenant_id) do update set revoked_at = null`;
  });

/** Chụp màn 1440x900 khi đặt WIZ_SHOTS=<thư mục> (bằng chứng UAT); mặc định không chụp. */
async function shot(page: Page, name: string) {
  const dir = process.env.WIZ_SHOTS;
  if (!dir) return;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: `${dir}/wizard-${name}.png` });
}

const stepper = (page: Page) => page.getByRole("navigation", { name: "Các bước thêm công ty" });

test("ADM-FR-79 · AC1,AC2,AC4 · sidebar '+' → bước 1 tạo công ty ngay, Thoát ⇒ công ty còn, 'Onboard lại' mở bước 2, lưu app, bỏ qua bước 3, Xem lại, Hoàn tất ⇒ tab Tổng quan", async ({
  page,
}) => {
  await fakePacks(page, ANY_ID, {}, syncWizco);
  await loginAdmin(page);
  await page
    .getByRole("navigation", { name: "Điều hướng chính" })
    .getByRole("link", { name: "Tạo công ty" })
    .click();
  await expect(page).toHaveURL(/\/tenants\/new$/);
  await expect(page.getByRole("heading", { level: 1, name: "Thêm công ty" })).toBeVisible();
  await expect(stepper(page).locator('[aria-current="step"]')).toContainText("Thông tin");
  await expect(stepper(page).getByRole("listitem")).toHaveCount(4);

  await shot(page, "1-company");
  await page.getByRole("textbox", { name: "Mã công ty" }).fill("wizco");
  await page.getByRole("textbox", { name: "Tên công ty" }).fill("Wiz Co");
  await page.getByRole("textbox", { name: "Tên đăng nhập" }).fill("wizadmin");
  await page.getByRole("textbox", { name: "Tên hiển thị" }).fill("Wiz Admin");
  await page.getByRole("textbox", { name: "Email" }).fill("wiz@wizco.test");
  await page.getByRole("button", { name: "Tạo tenant", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Đã tạo tenant wizco" });
  await dialog.getByRole("checkbox", { name: "Tôi đã lưu mật khẩu tạm" }).check();
  await dialog.getByRole("button", { name: "Tiếp tục cấu hình" }).click();
  await expect(page).toHaveURL(/\/tenants\/new\?.*tenant=[0-9a-f-]{36}/);
  await expect(page).toHaveURL(/step=2/);
  await expect(stepper(page).locator('[aria-current="step"]')).toContainText("Ứng dụng & Gói");

  // AC1 · bỏ ngang ở bước 2: công ty đã tạo ngay (DB) và tiếp được ở workspace.
  const tenantId = await withOwner(async (sql) => {
    const rows = await sql`select id from admin.tenants where key = 'wizco'`;
    return rows[0]?.id as string;
  });
  expect(tenantId).toMatch(/^[0-9a-f-]{36}$/);
  await page.reload(); // resume: trạng thái nằm trên URL
  await expect(stepper(page).locator('[aria-current="step"]')).toContainText("Ứng dụng & Gói");
  await page.getByRole("button", { name: "Thoát, tiếp tục ở workspace" }).click();
  await expect(page).toHaveURL(new RegExp(`/tenants/${tenantId}`));
  await expect(page.getByRole("heading", { level: 1, name: "Wiz Co" })).toBeVisible();

  // AC4 · "Onboard lại" mở bước 2.
  await page.getByRole("button", { name: "Onboard lại" }).click();
  await expect(page).toHaveURL(new RegExp(`/tenants/new\\?.*tenant=${tenantId}`));
  await expect(stepper(page).locator('[aria-current="step"]')).toContainText("Ứng dụng & Gói");

  // Bước 2 dùng nguyên tab Ứng dụng & Gói: đặt mức Xem + Lưu; Tiếp tục khoá khi còn nháp.
  const card = page.getByRole("region", { name: "Sổ Hợp Tác" });
  const next = page.getByRole("button", { name: "Tiếp tục", exact: true });
  await card
    .getByRole("radiogroup", { name: "Mức dùng Sổ Hợp Tác" })
    .getByRole("radio", { name: "Xem" })
    .click();
  await expect(next).toBeDisabled();
  await page.getByRole("button", { name: "Lưu", exact: true }).click();
  await expect(toast(page, "Đã lưu tính năng cho")).toBeVisible();
  await expect(next).toBeEnabled();
  await shot(page, "2-apps");
  await next.click();

  // AC2 · bước 3 bỏ qua được.
  await expect(stepper(page).locator('[aria-current="step"]')).toContainText(
    "Phân quyền & Người dùng",
  );
  await shot(page, "3-people");
  await page.getByRole("button", { name: "Bỏ qua" }).click();
  await expect(stepper(page).locator('[aria-current="step"]')).toContainText("Xem lại");
  await expect(page.getByTestId("ov-users")).toHaveText("1");
  await expect(page.getByTestId("ov-apps")).toHaveText("1");
  await shot(page, "4-review");
  await page.getByRole("button", { name: "Hoàn tất" }).click();
  await expect(page).toHaveURL(new RegExp(`/tenants/${tenantId}\\?.*tab=overview`));
  await expect(page.getByRole("tab", { name: "Tổng quan", selected: true })).toBeVisible();
  await expect(page.getByTestId("ov-roles")).toBeVisible();
  await shot(page, "overview");
});

test("ADM-FR-79 · AC3 · mã trùng 'acme' ⇒ lỗi ngay ở bước 1, chưa có công ty mới, vẫn bước 1", async ({
  page,
}) => {
  await loginAdmin(page);
  await page.goto("/tenants/new");
  await page.getByRole("textbox", { name: "Mã công ty" }).fill("acme");
  await page.getByRole("textbox", { name: "Tên công ty" }).fill("Acme Dup");
  await page.getByRole("textbox", { name: "Tên đăng nhập" }).fill("dupadmin");
  await page.getByRole("textbox", { name: "Tên hiển thị" }).fill("Dup Admin");
  await page.getByRole("textbox", { name: "Email" }).fill("dup@acme-dup.test");
  await page.getByRole("button", { name: "Tạo tenant", exact: true }).click();
  await expect(page.getByText("Mã công ty đã được dùng")).toBeVisible();
  await expect(page).toHaveURL(/\/tenants\/new$/);
  await expect(stepper(page).locator('[aria-current="step"]')).toContainText("Thông tin");
});

test("ADM-FR-77 AC4 · tenant_admin: tab Quota rút gọn chỉ đọc (run/token, không tiền), không gọi route chỉ-platform", async ({
  page,
}) => {
  await withOwner(async (sql) => {
    await setQuota(sql, TENANT_ID.acme, null, { runs: 100, usd: "5.00" });
    await insertUsage(sql, 3, { tenant: TENANT_ID.acme });
  });
  const platformOnly: string[] = [];
  page.on("request", (r) => {
    if (/\/daily-limits|\/grants\/matrix|\/packs/.test(r.url())) platformOnly.push(r.url());
  });
  await loginAs(page, "acme", "binh");
  await page.goto(`/tenants/${TENANT_ID.acme}?tab=quota`);
  await expect(page.getByRole("tab", { name: "Quota", selected: true })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: /^Quota tháng/ })).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "Run · Cả tenant" })).toHaveAttribute(
    "aria-valuetext",
    /3.*100/,
  );
  await expect(page.getByText("Số USD")).toHaveCount(0);
  await expect(page.getByText("USD", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("spinbutton")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Lưu", exact: true })).toHaveCount(0);
  expect(platformOnly).toEqual([]);
  await shot(page, "quota-tenant-admin");

  // Tab Tổng quan (đọc được cho tenant_admin): số người dùng + quota.
  await page.getByRole("tab", { name: "Tổng quan" }).click();
  await expect(page.getByTestId("ov-users")).toBeVisible();
});
