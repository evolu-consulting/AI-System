// CR-111 · e2e: danh mục Feature nhóm theo app (tên dễ hiểu + mô tả, key kỹ thuật mờ, badge "Tính năng thêm") và tab Feature của
// chi tiết công ty (CR-112: tab Ứng dụng & Gói — thẻ app chọn mức Tắt/Xem/Sửa/Quản trị + tính năng thêm, mức điều khiển cả gói, lưu một
// lượt). admin-api + DB e2e THẬT; riêng `/packs*` giả (support/fake-packs.ts).
import { expect, test } from "@playwright/test";
import { fakePacks } from "./support/fake-packs";
import { loginAdmin, openPage, resetFixture, TENANT_ID, toast, withOwner } from "./support/helpers";

test.describe.configure({ mode: "serial" });

const NEW_FEATURES = [
  "contracts-read",
  "contracts-write",
  "contracts-admin",
  "han-muc-duyet",
  "community-read",
];

/** Feature theo registry CR-111 (tên lạ trong DB, UI hiện tên dễ hiểu); acme chỉ được cấp `contracts-write` (bộ không chuẩn). */
test.beforeAll(async () => {
  resetFixture();
  await withOwner(async (sql) => {
    for (const key of NEW_FEATURES) {
      await sql`insert into admin.features (key, name, status)
        values (${key}, ${sql.json({ vi: key.replace("-", ".") })}, 'on') on conflict (key) do nothing`;
    }
    await sql`insert into admin.feature_entitlements (feature_id, tenant_id)
      select f.id, t.id from admin.features f, admin.tenants t
      where f.key = 'contracts-write' and t.key = 'acme' on conflict do nothing`;
  });
});

test.afterAll(() => resetFixture()); // trả fixture gốc cho spec kế (feature thêm ở trên không được rò sang)

const acmeKeys = () =>
  withOwner(async (sql) => {
    const rows = await sql`select f.key from admin.feature_entitlements e
      join admin.features f on f.id = e.feature_id
      join admin.tenants t on t.id = e.tenant_id
      where t.key = 'acme' and e.revoked_at is null and f.key = any(${NEW_FEATURES})
      order by f.key`;
    return rows.map((r) => r.key as string);
  });

test("CR-111 · /features nhóm theo app: tên dễ hiểu + mô tả, key mono, badge 'Tính năng thêm' và 'Mặc định'", async ({
  page,
}) => {
  await loginAdmin(page);
  await openPage(page, "/features", "Features");
  await expect(page.getByRole("heading", { level: 2, name: "Sổ Hợp Tác" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Cơ bản" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Khác" })).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: "han-muc-duyet" });
  await expect(row).toContainText("Kiểm tra hạn mức duyệt");
  await expect(row).toContainText("Tính năng thêm");
  await expect(row.getByText("han-muc-duyet", { exact: true })).toHaveClass(/font-mono/);
  await expect(page.getByRole("row").filter({ hasText: "contracts-read" })).toContainText(
    "Xem hợp đồng",
  );
  await expect(page.getByRole("row").filter({ hasText: /(?<![\w-])core(?![\w-])/ })).toContainText(
    "Mặc định",
  );
});

test("CR-112 · tab Ứng dụng & Gói của acme: bộ 'Không chuẩn' → Quản trị + tính năng thêm → lưu một lượt (bật gói trước khi cấp); Tắt có xác nhận (thu hồi trước khi tắt gói)", async ({
  page,
}) => {
  const calls = await fakePacks(page, TENANT_ID.acme);
  await loginAdmin(page);
  await page.goto(`/tenants/${TENANT_ID.acme}?tab=features`);
  await expect(page.getByRole("tab", { name: "Ứng dụng" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  const card = page.getByRole("region", { name: "Sổ Hợp Tác" });
  await expect(card).toContainText("Đang: Sửa");
  await expect(card.getByText("Không chuẩn")).toBeVisible();
  await expect(card).toContainText("Gói chưa bật");
  await expect(card).toContainText("3 vai");
  await expect(card).toContainText("3 người");
  const level = card.getByRole("radiogroup", { name: "Mức dùng Sổ Hợp Tác" });
  const addon = card.getByRole("switch", { name: "Bật Kiểm tra hạn mức duyệt" });
  const save = page.getByRole("button", { name: "Lưu", exact: true });
  await expect(save).toBeDisabled();

  await level.getByRole("radio", { name: "Quản trị" }).click();
  await addon.click();
  await expect(page.getByText("Chưa lưu: cấp 3, thu hồi 0 · bật 1 gói, tắt 0 gói")).toBeVisible();
  await expect(card).toContainText("Đang: Quản trị · 1 tính năng thêm");
  await save.click(); // chỉ bật/cấp ⇒ không hỏi xác nhận
  await expect(toast(page, "Đã lưu tính năng cho")).toBeVisible();
  expect(calls).toEqual(["PUT contracts"]);
  expect(await acmeKeys()).toEqual([
    "contracts-admin",
    "contracts-read",
    "contracts-write",
    "han-muc-duyet",
  ]);
  await expect(card.getByText("Không chuẩn")).toHaveCount(0);
  await expect(card).toContainText("Gói đang bật");

  await level.getByRole("radio", { name: "Tắt" }).click();
  await expect(addon).toBeDisabled();
  await expect(card).toContainText("Đang: Tắt");
  await save.click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("3 người dùng của công ty mất quyền vào ứng dụng này");
  await expect(dialog).toContainText("4 tính năng sẽ bị thu hồi");
  await dialog.getByRole("button", { name: "Lưu", exact: true }).click();
  await expect(card).toContainText("Gói chưa bật"); // lưu xong (cả thu hồi lẫn tắt gói) rồi mới đọc DB
  await expect.poll(acmeKeys).toEqual([]);
  expect(calls).toEqual(["PUT contracts", "DELETE contracts"]);
});

test("CR-112 · URL cũ ?tab=packs mở tab Ứng dụng & Gói, tab Gói không còn", async ({ page }) => {
  await fakePacks(page, TENANT_ID.acme);
  await loginAdmin(page);
  await page.goto(`/tenants/${TENANT_ID.acme}?tab=packs`);
  await expect(page.getByRole("tab", { name: "Ứng dụng" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByRole("tab", { name: "Gói", exact: true })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Sổ Hợp Tác" })).toBeVisible();
});
