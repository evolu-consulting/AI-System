// ADM-FR-35 · ADM-FR-32 · ADM-BR-12 · M3-R08, R09 · e2e Phân quyền › Ma trận (test-plan E-AM). Nhãn nguyên văn plan-frontend §5.
// FE3a chỉ kiểm HAI nút tab (không kiểm nội dung tab "Kiểm tra quyền", Gate M3 §3 mục 3). Dữ liệu: acme (3 group, 5 feature
// ngoài core), globex (ke-toan đã thu hồi, còn grant).
import { expect, type Page, test } from "@playwright/test";
import {
  apiAsAdmin,
  ID,
  loginAdmin,
  loginAs,
  resetFixture,
  seedPhapChe,
  TENANT_ID,
  toast,
  withOwner,
} from "./support/helpers";

test.describe.configure({ mode: "serial" });
test.beforeEach(async () => {
  resetFixture();
  await seedPhapChe();
});

const grid = (page: Page) => page.getByRole("grid", { name: "Ma trận feature × group" });
const cell = (page: Page, feature: string, group: string) =>
  page.getByRole("checkbox", { name: `${feature} cho group ${group}` });
const dirty = (page: Page, n: number) =>
  page.getByRole("status").filter({ hasText: `${n} thay đổi chưa lưu` });
const openMatrix = async (page: Page, tenant = "acme", user = "binh") => {
  await loginAs(page, tenant, user);
  await page.getByRole("navigation").getByRole("link", { name: "Phân quyền" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Phân quyền" })).toBeVisible();
  await expect(grid(page)).toBeVisible();
};
const grantCount = (featureId: string) =>
  withOwner(async (sql) => {
    const [r] =
      await sql`select count(*)::int as n from admin.feature_grants where feature_id = ${featureId}`;
    return r?.n as number;
  });

test("ADM-FR-35 · M3-R13 · trang Phân quyền: heading, hai tab 'Ma trận' và 'Kiểm tra quyền'; platform admin có combobox Tenant, chưa chọn → KHÔNG gọi /admin/grants/matrix", async ({
  page,
}) => {
  const calls: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/admin/grants/matrix")) calls.push(r.url());
  });
  await loginAdmin(page);
  await page.goto("/access");
  await expect(page.getByRole("heading", { level: 1, name: "Phân quyền" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Ma trận", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Kiểm tra quyền", exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Tenant" })).toBeVisible();
  await expect(page.getByText("Chọn một tenant để phân quyền cho tenant đó.")).toBeVisible();
  expect(calls).toEqual([]);
});

test("ADM-FR-35 · M3-R09 · acme: hàng core có 'Mặc định' và ô khoá (aria-disabled); ô 'Kế toán cho group Kế toán' đã tick (G1), 'Dịch thuật cho group Kinh doanh' chưa", async ({
  page,
}) => {
  await openMatrix(page);
  await expect(grid(page).getByText("Mặc định")).toBeVisible();
  await expect(cell(page, "Kế toán", "Kế toán")).toBeChecked();
  await expect(cell(page, "Dịch thuật", "Kinh doanh")).not.toBeChecked();
  await expect(page.getByRole("checkbox", { name: /^Cấp Kế toán cho mọi group$/ })).toBeVisible();
});

test("ADM-FR-35 · M3-R08 · tick 1 ô → '1 thay đổi chưa lưu' (chấm chưa lưu); 'Huỷ' bỏ nháp → ô về cũ, Lưu khoá, không gọi API ghi", async ({
  page,
}) => {
  await openMatrix(page);
  const writes: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET" && r.url().includes("/admin/grants")) writes.push(r.url());
  });
  await cell(page, "Dịch thuật", "Kinh doanh").check();
  await expect(dirty(page, 1)).toBeVisible();
  await expect(page.getByRole("button", { name: "Lưu", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Huỷ", exact: true }).click();
  await expect(cell(page, "Dịch thuật", "Kinh doanh")).not.toBeChecked();
  await expect(page.getByRole("button", { name: "Lưu", exact: true })).toBeDisabled();
  expect(writes).toEqual([]);
});

test("ADM-FR-35 · M3-R09 · tick cả hàng 'Cấp Dịch thuật cho mọi group' → '3 thay đổi chưa lưu'; tick cả cột 'Cấp mọi feature cho group Kinh doanh' bỏ qua ô khoá (core, chưa mở) → 4 thay đổi", async ({
  page,
}) => {
  await openMatrix(page);
  await page.getByRole("checkbox", { name: "Cấp Dịch thuật cho mọi group" }).click();
  await expect(dirty(page, 3)).toBeVisible();
  await page.getByRole("button", { name: "Huỷ", exact: true }).click();
  await page.getByRole("checkbox", { name: "Cấp mọi feature cho group Kinh doanh" }).click();
  await expect(dirty(page, 4)).toBeVisible();
});

test("ADM-FR-35 · M3-R08 · Lưu 2 ô gửi ĐÚNG MỘT PUT /admin/grants/batch → toast 'Đã lưu quyền · 2 cấp, 0 thu…'; DB có 2 grant mới", async ({
  page,
}) => {
  await openMatrix(page);
  await cell(page, "Dịch thuật", "Kinh doanh").check();
  await cell(page, "Thử nghiệm", "Kinh doanh").check();
  const puts: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "PUT" && r.url().includes("/admin/grants/batch")) puts.push(r.url());
  });
  const saved = page.waitForResponse(
    (r) => r.url().includes("/admin/grants/batch") && r.request().method() === "PUT",
  );
  await page.getByRole("button", { name: "Lưu", exact: true }).click();
  expect((await saved).status()).toBe(200);
  await expect(toast(page, /Đã lưu quyền · 2 cấp, 0 thu/)).toBeVisible();
  expect(puts).toHaveLength(1);
  expect(await grantCount(ID.feature.dichThuat)).toBe(2);
  expect(await grantCount(ID.feature.thuNghiem)).toBe(1);
});

test("ADM-FR-35 · M3-R09 · switch 'Hiện feature chưa mở (1)' → hàng Pháp chế mờ, ô không sửa được (aria-disabled), tooltip 'Công ty chưa được mở feature này'", async ({
  page,
}) => {
  await openMatrix(page);
  await expect(grid(page).getByText("Pháp chế")).toHaveCount(0);
  await page.getByRole("switch", { name: "Hiện feature chưa mở (1)" }).click();
  await expect(grid(page).getByText("Pháp chế")).toBeVisible();
  const locked = cell(page, "Pháp chế", "Kế toán");
  await expect(locked).toHaveAttribute("aria-disabled", "true");
  await locked.hover();
  await expect(page.getByText("Công ty chưa được mở feature này")).toBeVisible();
});

test("ADM-BR-12 · M3-R09 · platform chọn globex: hàng Kế toán hiện 'Đã thu hồi entitlement', ô giữ tick nhưng KHÔNG sửa được (aria-checked không đổi khi click)", async ({
  page,
}) => {
  await loginAdmin(page);
  await page.goto("/access?tenant=globex");
  await expect(grid(page)).toBeVisible();
  await expect(grid(page).getByText("Đã thu hồi entitlement")).toBeVisible();
  const box = cell(page, "Kế toán", "Kế toán");
  await expect(box).toBeChecked();
  await box.click({ force: true });
  await expect(box).toBeChecked();
  await expect(dirty(page, 1)).toHaveCount(0);
});

test("ADM-BR-12 · M3-R10 · thu hồi entitlement acme ke-toan qua API rồi tải lại → hàng 'Đã thu hồi entitlement' mà TICK GIỮ NGUYÊN; cấp lại → hàng thường", async ({
  page,
  request,
}) => {
  await openMatrix(page);
  const api = await apiAsAdmin(request);
  const url = `/admin/features/${ID.feature.keToan}/entitlements/${TENANT_ID.acme}`;
  expect((await api.del(url)).status()).toBe(204);
  await page.reload();
  await expect(grid(page).getByText("Đã thu hồi entitlement")).toBeVisible();
  await expect(cell(page, "Kế toán", "Kế toán")).toBeChecked();
  expect((await api.put(url)).status()).toBe(200);
  await page.reload();
  await expect(grid(page).getByText("Đã thu hồi entitlement")).toHaveCount(0);
  await expect(cell(page, "Kế toán", "Kế toán")).toBeEnabled();
});

test("ADM-FR-35 · M3-R09 · bàn phím: ô đầu nhận focus, ArrowRight sang ô kế, Space đổi trạng thái → '1 thay đổi chưa lưu'", async ({
  page,
}) => {
  await openMatrix(page);
  const first = cell(page, "Dịch thuật", "Beta testers");
  await first.focus();
  await page.keyboard.press("ArrowRight");
  await expect(cell(page, "Dịch thuật", "Kế toán")).toBeFocused();
  await page.keyboard.press("Space");
  await expect(cell(page, "Dịch thuật", "Kế toán")).toBeChecked();
  await expect(dirty(page, 1)).toBeVisible();
});

test("ADM-FR-35 · M3-R08 · 205 group thêm: tick cả hàng Dịch thuật → 208 thay đổi → 'Lưu' bị khoá + 'Tối đa 200 thay đổi mỗi lần lưu (đang có 208)…'; số ô checkbox trong DOM ≤ 300 (cửa sổ hoá)", async ({
  page,
}) => {
  await withOwner(async (sql) => {
    const keys = Array.from({ length: 205 }, (_, i) => `gr${String(i).padStart(3, "0")}`);
    await sql`insert into admin.groups (tenant_id, key, name)
      select ${TENANT_ID.acme}, k, jsonb_build_object('vi', k) from unnest(${keys}::text[]) as k`;
  });
  await openMatrix(page);
  await page.getByRole("checkbox", { name: "Cấp Dịch thuật cho mọi group" }).click();
  await expect(page.getByText(/Tối đa 200 thay đổi mỗi lần lưu \(đang có 208\)/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Lưu", exact: true })).toBeDisabled();
  expect(await grid(page).getByRole("checkbox").count()).toBeLessThanOrEqual(300);
});

test("ADM-FR-32 · M3-R07 · NOT_ENTITLED giữa lúc lưu (owner thu hồi dich-thuat trước khi bấm Lưu) → toast 'Công ty chưa được mở feature này nên không cấp được. Đã tải lại ma trận.'; KHÔNG ghi một phần", async ({
  page,
}) => {
  await openMatrix(page);
  await cell(page, "Dịch thuật", "Kinh doanh").check();
  await cell(page, "Thử nghiệm", "Kinh doanh").check();
  await withOwner(async (sql) => {
    await sql`update admin.feature_entitlements set revoked_at = now()
      where feature_id = ${ID.feature.dichThuat} and tenant_id = ${TENANT_ID.acme}`;
  });
  await page.getByRole("button", { name: "Lưu", exact: true }).click();
  await expect(
    toast(page, "Công ty chưa được mở feature này nên không cấp được. Đã tải lại ma trận."),
  ).toBeVisible();
  expect(await grantCount(ID.feature.thuNghiem)).toBe(0);
  expect(await grantCount(ID.feature.dichThuat)).toBe(1);
});
