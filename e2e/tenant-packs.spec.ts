// CR-112 · ADM-FR-78 · (PK-FR-05, D-05, UAT CR-095 B3): platform_admin đặt MỨC của app ở tab "Ứng dụng & Gói" của chi tiết công ty ⇒ gói bật/tắt
// + entitlement theo mức. admin-api + DB e2e THẬT cho đăng nhập, chi tiết tenant, entitlement; riêng `/admin/tenants/:id/packs*` giả
// (support/fake-packs.ts, kèm mô phỏng server cấp/thu hồi 3 entitlement mức) vì DB e2e gốc không chạy migration gói.
import { expect, test } from "@playwright/test";
import { fakePacks } from "./support/fake-packs";
import {
  loginToShell,
  resetFixture,
  seedAdmin,
  TENANT_ID,
  toast,
  withOwner,
} from "./support/helpers";

test.describe.configure({ mode: "serial" });

const KEYS = ["contracts-read", "contracts-write", "contracts-admin"];

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

/** Server thật bật gói `?level=L` ⇒ upsert entitlement chỉ tới mức L (CR-112 review fix), tắt ⇒ thu hồi cả 3. */
const syncEntitlements = (key: string, on: boolean, level: "read" | "write" | "admin") =>
  withOwner(async (sql) => {
    if (key !== "contracts") return;
    const upTo = KEYS.slice(0, ["read", "write", "admin"].indexOf(level) + 1);
    await (on
      ? sql`insert into admin.feature_entitlements (feature_id, tenant_id)
          select f.id, t.id from admin.features f, admin.tenants t
          where f.key = any(${upTo}) and t.key = 'acme'
          on conflict (feature_id, tenant_id) do update set revoked_at = null`
      : sql`update admin.feature_entitlements set revoked_at = now()
          where tenant_id = (select id from admin.tenants where key = 'acme')
            and feature_id in (select id from admin.features where key = any(${KEYS}))
            and revoked_at is null`);
  });

const acmeKeys = () =>
  withOwner(async (sql) => {
    const rows = await sql`select f.key from admin.feature_entitlements e
      join admin.features f on f.id = e.feature_id
      join admin.tenants t on t.id = e.tenant_id
      where t.key = 'acme' and e.revoked_at is null and f.key = any(${KEYS}) order by f.key`;
    return rows.map((r) => r.key as string);
  });

test("ADM-FR-78 · đặt mức Sửa ⇒ bật gói + entitlement Xem/Sửa (gỡ mức Quản trị do gói cấp sẵn), Tắt ⇒ hỏi xác nhận rồi tắt gói", async ({
  page,
}) => {
  const calls = await fakePacks(page, TENANT_ID.acme, {}, syncEntitlements);
  const a = seedAdmin();
  await loginToShell(page, "platform", a.username, a.password);
  await page.goto(`/tenants/${TENANT_ID.acme}`);
  await page.getByRole("tab", { name: "Ứng dụng" }).click();
  const card = page.getByRole("region", { name: "Sổ Hợp Tác" });
  await expect(card).toContainText("Đang: Tắt");
  await expect(card).toContainText("Gói chưa bật");
  const level = card.getByRole("radiogroup", { name: "Mức dùng Sổ Hợp Tác" });
  const save = page.getByRole("button", { name: "Lưu", exact: true });

  await level.getByRole("radio", { name: "Sửa" }).click();
  await expect(page.getByText("Chưa lưu: cấp 2, thu hồi 0 · bật 1 gói, tắt 0 gói")).toBeVisible();
  await save.click();
  await expect(toast(page, "Đã lưu tính năng cho")).toBeVisible();
  await expect(card).toContainText("Gói đang bật");
  expect(calls).toEqual(["PUT contracts"]);
  expect(await acmeKeys()).toEqual(["contracts-read", "contracts-write"]);

  await level.getByRole("radio", { name: "Tắt" }).click();
  await save.click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("Tắt gói Sổ Hợp Tác");
  await dialog.getByRole("button", { name: "Huỷ" }).click();
  expect(calls).toEqual(["PUT contracts"]);
  expect(await acmeKeys()).toEqual(["contracts-read", "contracts-write"]);

  await save.click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Lưu", exact: true }).click();
  await expect(card).toContainText("Gói chưa bật");
  expect(calls).toEqual(["PUT contracts", "DELETE contracts"]);
  expect(await acmeKeys()).toEqual([]);
});
