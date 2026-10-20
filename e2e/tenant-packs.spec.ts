// PK-FR-05 · D-05 · UAT CR-095 B3: platform_admin bật/tắt gói nghiệp vụ cho tenant ở tab "Gói" của chi tiết tenant.
// Đăng nhập + chi tiết tenant chạy admin-api THẬT; riêng `/admin/tenants/:id/packs*` giả bằng `page.route` (DB e2e gốc không chạy
// migration gói — hành vi API bật gói + trợ lý đã phủ ở int `tests/acceptance/N1/{admin-packs,pack-assistant}.int.test.ts`).
import { expect, type Page, test } from "@playwright/test";
import { loginToShell, resetFixture, seedAdmin, TENANT_ID } from "./support/helpers";

test.describe.configure({ mode: "serial" });
test.beforeAll(() => {
  resetFixture();
});

type Pack = { key: string; enabled: boolean; groups: { role: string; group_id: string }[] };
const GROUPS = ["owner", "editor", "viewer"].map((role, i) => ({
  role,
  group_id: `00000000-0000-4000-8000-00000000000${i + 1}`,
}));

/** Backend gói giả có trạng thái: GET liệt kê, PUT bật (200 PackState), DELETE tắt (204). Ghi lại các lời gọi ghi. */
async function fakePacks(page: Page, tenantId: string) {
  const state: Pack[] = [{ key: "contracts", enabled: false, groups: [] }];
  const calls: string[] = [];
  const re = new RegExp(`/admin/tenants/${tenantId}/packs(?:/([a-z_]+))?$`);
  await page.route(re, async (route) => {
    const req = route.request();
    const key = re.exec(new URL(req.url()).pathname)?.[1];
    const row = state.find((p) => p.key === key);
    if (req.method() === "GET" && !key) return route.fulfill({ json: { items: state } });
    if (!row) return route.fulfill({ status: 404, json: { error: { code: "PACK_NOT_FOUND" } } });
    calls.push(`${req.method()} ${key}`);
    if (req.method() === "PUT") {
      Object.assign(row, { enabled: true, groups: GROUPS });
      return route.fulfill({ json: row });
    }
    row.enabled = false;
    return route.fulfill({ status: 204, body: "" });
  });
  return calls;
}

test("UAT B3 · platform_admin mở tenant acme → tab Gói: bật Hợp đồng (PUT), tắt có hỏi xác nhận (DELETE)", async ({
  page,
}) => {
  const calls = await fakePacks(page, TENANT_ID.acme);
  const a = seedAdmin();
  await loginToShell(page, "platform", a.username, a.password);
  await page.goto(`/tenants/${TENANT_ID.acme}`);
  await page.getByRole("tab", { name: "Gói" }).click();
  const table = page.getByRole("table", { name: "Gói nghiệp vụ" });
  await expect(table).toBeVisible();
  const row = table.getByRole("row", { name: /Hợp đồng/ });
  await expect(row.getByText("Chưa bật")).toBeVisible();

  const sw = page.getByRole("switch", { name: "Bật gói Hợp đồng" });
  await expect(sw).not.toBeChecked();
  await sw.click();
  await expect(page.getByText("Đã bật gói Hợp đồng cho")).toBeVisible();
  await expect(row.getByText("Đang bật")).toBeVisible();
  await expect(sw).toBeChecked();
  expect(calls).toEqual(["PUT contracts"]);

  await sw.click();
  const dialog = page.getByRole("alertdialog", { name: "Tắt gói Hợp đồng?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Huỷ" }).click();
  await expect(sw).toBeChecked();
  expect(calls).toEqual(["PUT contracts"]);

  await sw.click();
  await page
    .getByRole("alertdialog", { name: "Tắt gói Hợp đồng?" })
    .getByRole("button", { name: "Tắt gói" })
    .click();
  await expect(row.getByText("Chưa bật")).toBeVisible();
  expect(calls).toEqual(["PUT contracts", "DELETE contracts"]);
});
