// ADM-FR-30, ADM-FR-31, ADM-FR-33, ADM-FR-34, ADM-BR-10 · e2e Features + entitlement (test-plan E-F; M2-AC04, M2-AC05).
// Nhãn nguyên văn: admin-missing-screens §3 + plan-frontend §5. Command/entitlement dựng bằng owner SQL / API.
import { expect, type Page, test } from "@playwright/test";
import {
  ID,
  loginAdmin,
  loginToShell,
  openPage,
  PW,
  resetFixture,
  toast,
  withOwner,
} from "./support/helpers";

test.describe.configure({ mode: "serial" });
test.beforeAll(() => {
  resetFixture();
});

/** Hàng bảng Features theo key (key hiển thị mono dưới tên VI). */
const row = (page: Page, key: string) =>
  page
    .getByRole("table", { name: "Features" })
    .getByRole("row")
    .filter({ hasText: new RegExp(`(?<![\\w-])${key}(?![\\w-])`) });
const rowMenu = async (page: Page, key: string, item: string) => {
  await row(page, key).getByRole("button", { name: "Thao tác khác" }).click();
  await page.getByRole("menuitem", { name: item, exact: true }).click();
};
const openFeature = async (page: Page, key: string, tab?: string) => {
  await openPage(page, "/features", "Features");
  await rowMenu(page, key, "Sửa");
  await expect(page).toHaveURL(/\/features\/[0-9a-f-]{36}/);
  if (tab) await page.getByRole("tab", { name: tab, exact: true }).click();
};

test("ADM-FR-30 · M2-R20 · /features: heading, bảng, core có badge 'Mặc định' + 'Mọi tenant', chip Tất cả 5 / Bật 3 / Beta 1 / Tắt 1; menu ⋯ của core chỉ có 'Sửa'", async ({
  page,
}) => {
  await loginAdmin(page);
  await openPage(page, "/features", "Features");
  await expect(page.getByRole("link", { name: "+ Tạo feature" })).toBeVisible();
  await expect(row(page, "core")).toContainText("Mặc định");
  await expect(row(page, "core")).toContainText("Mọi tenant");
  for (const [label, n] of [
    ["Tất cả", 5],
    ["Bật", 3],
    ["Beta", 1],
    ["Tắt", 1],
  ] as const) {
    await expect(page.getByRole("radio", { name: new RegExp(`${label}\\s*${n}`) })).toBeVisible();
  }
  await row(page, "core").getByRole("button", { name: "Thao tác khác" }).click();
  await expect(page.getByRole("menuitem")).toHaveCount(1);
  await expect(page.getByRole("menuitem", { name: "Sửa" })).toBeVisible();
});

test("ADM-FR-30 · M2-R20 · tạo feature: key sai → lỗi định dạng; key đúng + tên + 'Bật' → /features/<uuid>; sau lưu ô Key readOnly + 'Key không đổi được sau khi tạo'", async ({
  page,
}) => {
  await loginAdmin(page);
  await openPage(page, "/features", "Features");
  await page.getByRole("link", { name: "+ Tạo feature" }).click();
  await expect(page).toHaveURL(/\/features\/new$/);
  const key = page.getByRole("textbox", { name: "Key", exact: true });
  await key.fill("Ke Toan");
  await page.getByRole("textbox", { name: "Tên", exact: true }).fill("Nhân sự");
  await page.getByRole("radio", { name: "Bật", exact: true }).check();
  await page.getByRole("button", { name: "Lưu", exact: true }).click();
  await expect(
    page.getByText("Chỉ dùng chữ thường không dấu, số, dấu - (2–32 ký tự)"),
  ).toBeVisible();
  await key.fill("nhan-su");
  const saved = page.waitForResponse(
    (r) => r.url().includes("/admin/features") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Lưu", exact: true }).click();
  expect((await saved).status()).toBe(201);
  await expect(page).toHaveURL(/\/features\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("textbox", { name: "Key", exact: true })).toHaveAttribute(
    "readonly",
    "",
  );
  await expect(page.getByText("Key không đổi được sau khi tạo")).toBeVisible();
});

test("ADM-FR-33 · ADM-FR-34 · BR-06 · kill switch: 'Tắt' ke-toan → alertdialog 'Tắt Kế toán?' nêu 1 command và 6 người → badge Tắt, command vẫn BẬT; 'Chuyển sang Beta' → badge Beta", async ({
  page,
}) => {
  await loginAdmin(page);
  await openPage(page, "/features", "Features");
  await rowMenu(page, "ke-toan", "Tắt");
  const dialog = page.getByRole("alertdialog", { name: "Tắt Kế toán?" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("1 command");
  await expect(dialog).toContainText("6 người");
  const patched = page.waitForResponse(
    (r) => r.url().includes("/admin/features/") && r.request().method() === "PATCH",
  );
  await dialog.getByRole("button", { name: "Tắt feature" }).click();
  expect((await patched).status()).toBe(200);
  await expect(row(page, "ke-toan")).toContainText("Tắt");
  const [cmd] = await withOwner(
    (sql) => sql`select enabled from admin.commands where id = ${ID.command.kiemtraHoadon}`,
  );
  expect(cmd?.enabled).toBe(true);
  await rowMenu(page, "ke-toan", "Chuyển sang Beta");
  await expect(row(page, "ke-toan")).toContainText("Beta");
});

test("ADM-BR-10 · M2-R20 · editor core: trạng thái khoá + gợi ý 'Feature mặc định: luôn bật…'; vẫn sửa được tên", async ({
  page,
}) => {
  await loginAdmin(page);
  await openFeature(page, "core");
  await expect(
    page.getByText("Feature mặc định: luôn bật và tự có hiệu lực với mọi người dùng"),
  ).toBeVisible();
  for (const name of ["Bật", "Beta", "Tắt"]) {
    await expect(page.getByRole("radio", { name, exact: true })).toBeDisabled();
  }
  await page.getByRole("textbox", { name: "Tên", exact: true }).fill("Cơ bản 2");
  const patched = page.waitForResponse(
    (r) => r.url().includes("/admin/features/") && r.request().method() === "PATCH",
  );
  await page.getByRole("button", { name: "Lưu", exact: true }).click();
  expect((await patched).status()).toBe(200);
});

test("ADM-BR-10 · M2-AC04 · tab Commands: thêm /tom-tat lưu được; bỏ /kiemtra-hoadon (chỉ thuộc feature này) → cảnh báo mồ côi + 'Command phải thuộc ít nhất một feature', KHÔNG gửi PATCH", async ({
  page,
}) => {
  await loginAdmin(page);
  await openFeature(page, "ke-toan", "Commands");
  await page.getByRole("combobox", { name: "Thêm command" }).click();
  await page.getByRole("option", { name: /tom-tat/ }).click();
  const saved = page.waitForResponse(
    (r) => r.url().includes("/admin/features/") && r.request().method() === "PATCH",
  );
  await page.getByRole("button", { name: "Lưu", exact: true }).click();
  expect((await saved).status()).toBe(200);
  const patches: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "PATCH" && r.url().includes("/admin/features/")) patches.push(r.url());
  });
  await page.getByRole("button", { name: "Bỏ /kiemtra-hoadon khỏi feature" }).click();
  await expect(
    page.getByText("/kiemtra-hoadon sẽ không thuộc feature nào và biến khỏi menu"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Lưu", exact: true }).click();
  await expect(page.getByText("Command phải thuộc ít nhất một feature")).toBeVisible();
  expect(patches).toEqual([]);
});

test("ADM-FR-30 · M2-R21 · xoá: dich-thuat (/tr-nhanh độc quyền) → dialog 'Không xoá được Dịch thuật' liệt kê /tr-nhanh; thu-nghiem (rỗng) → gõ key → xoá", async ({
  page,
}) => {
  await loginAdmin(page);
  await openPage(page, "/features", "Features");
  await rowMenu(page, "dich-thuat", "Xoá");
  const blocked = page.getByRole("alertdialog", { name: /Không xoá được Dịch thuật/ });
  await expect(blocked).toBeVisible();
  await expect(blocked).toContainText("/tr-nhanh");
  await blocked.getByRole("button", { name: "Đóng" }).click();
  await expect(blocked).toHaveCount(0);
  await rowMenu(page, "thu-nghiem", "Xoá");
  const confirm = page.getByRole("alertdialog");
  await confirm.getByRole("textbox", { name: /Gõ thu-nghiem/ }).fill("thu-nghiem");
  const deleted = page.waitForResponse(
    (r) => r.url().includes("/admin/features/") && r.request().method() === "DELETE",
  );
  await confirm.getByRole("button", { name: /^Xoá/ }).click();
  expect((await deleted).status()).toBe(204);
  await expect(row(page, "thu-nghiem")).toHaveCount(0);
});

test("ADM-FR-31 · M2-AC05 · tab Tenant: acme có hàng, globex (đã thu hồi) không; '+ Cấp cho tenant' → globex → toast; Thu hồi acme (gõ acme) → toast + Hoàn tác trong 5 s → cấp lại CÙNG hàng", async ({
  page,
}) => {
  await loginAdmin(page);
  await openFeature(page, "ke-toan", "Tenant");
  const table = page.getByRole("table").last();
  await expect(table.getByRole("row").filter({ hasText: "acme" })).toBeVisible();
  await expect(table.getByRole("row").filter({ hasText: "globex" })).toHaveCount(0);
  await page.getByRole("button", { name: "+ Cấp cho tenant" }).click();
  await page.getByRole("option", { name: /globex/ }).click();
  await expect(toast(page, "Đã cấp Kế toán cho globex")).toBeVisible();
  await expect(table.getByRole("row").filter({ hasText: "globex" })).toBeVisible();
  await table
    .getByRole("row")
    .filter({ hasText: "acme" })
    .getByRole("button", { name: "Thu hồi" })
    .click();
  const dialog = page.getByRole("alertdialog", { name: "Thu hồi Kế toán của acme?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("textbox", { name: "Gõ acme để xác nhận" }).fill("acme");
  await dialog.getByRole("button", { name: /^Thu hồi/ }).click();
  const revoked = toast(page, "Đã thu hồi Kế toán của acme");
  await expect(revoked).toBeVisible();
  await expect(table.getByRole("row").filter({ hasText: "acme" })).toHaveCount(0);
  await revoked.getByRole("button", { name: "Hoàn tác" }).click();
  await expect(table.getByRole("row").filter({ hasText: "acme" })).toBeVisible();
  const rows = await withOwner(
    (sql) => sql`select revoked_at from admin.feature_entitlements e
      join admin.tenants t on t.id = e.tenant_id
      where e.feature_id = ${ID.feature.keToan} and t.key = 'acme'`,
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]?.revoked_at).toBeNull();
});

test("ADM-BR-10 · M2-R22 · core ở tab Tenant: 'Feature core được cấp cho mọi tenant.', không có nút '+ Cấp cho tenant'; tenant khoá (zeta) vẫn chọn cấp được ở feature thường", async ({
  page,
}) => {
  await loginAdmin(page);
  await openFeature(page, "core", "Tenant");
  await expect(page.getByText("Feature core được cấp cho mọi tenant.")).toBeVisible();
  await expect(page.getByRole("button", { name: "+ Cấp cho tenant" })).toHaveCount(0);
  await openFeature(page, "bao-cao", "Tenant");
  await page.getByRole("button", { name: "+ Cấp cho tenant" }).click();
  await expect(page.getByRole("option", { name: /zeta/ })).toBeVisible();
});

test("ADM-BR-14 · M2-AC01 · tenant_admin (binh) mở /features → ForbiddenState, không gọi /admin/features", async ({
  page,
}) => {
  const calls: string[] = [];
  page.on("request", (r) => calls.push(r.url()));
  await loginToShell(page, "acme", "binh", PW);
  await page.goto("/features");
  await expect(
    page.getByRole("heading", { name: "Bạn không có quyền xem trang này" }),
  ).toBeVisible();
  expect(calls.filter((u) => u.includes("/admin/features"))).toEqual([]);
});
