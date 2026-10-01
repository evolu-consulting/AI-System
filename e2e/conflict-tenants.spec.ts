// ADM-FR-55 · M3-AC08 · ConflictDialog cho Tenant (tab Thông tin) — câu KHÔNG có {user} (tenant không có updated_by).
// Test-plan E-CT. Người kia sửa bằng API; người mình sửa Tên công ty rồi Lưu.
import { expect, type Page, test } from "@playwright/test";
import {
  dbValue,
  expectConflictBody,
  expectDiff,
  overwrite,
  reloadLatest,
  versionOf,
} from "./support/conflict";
import { apiAsAdmin, loginAdmin, resetFixture, TENANT_ID } from "./support/helpers";

test.describe.configure({ mode: "serial" });
test.beforeEach(() => {
  resetFixture();
});

async function conflictOnAcme(page: Page, request: Parameters<typeof apiAsAdmin>[0]) {
  await loginAdmin(page);
  await page.goto(`/tenants/${TENANT_ID.acme}`);
  const name = page.getByRole("textbox", { name: "Tên công ty" });
  await name.fill("Acme A");
  const mine = await versionOf("tenants", TENANT_ID.acme);
  const api = await apiAsAdmin(request);
  const theirs = await api.patch(`/admin/tenants/${TENANT_ID.acme}`, {
    version: mine,
    max_concurrent_sub: 7,
  });
  expect(theirs.status()).toBe(200);
  await page.getByRole("button", { name: "Lưu", exact: true }).click();
  return { mine, latest: mine + 1, name };
}

test("ADM-FR-55 · M3-AC08 · tenant: alertdialog không {user}; Xem khác biệt có name và max_concurrent_sub; Ghi đè → version +2, tên và max_concurrent_sub của mình (5)", async ({
  page,
  request,
}) => {
  const { mine, latest } = await conflictOnAcme(page, request);
  await expectConflictBody(page, { entity: "tenant", latest, mine });
  await expectDiff(page, {
    latest,
    fields: ["name", "max_concurrent_sub"],
    absent: ["key", "version"],
  });
  await overwrite(page, { latest });
  expect(await dbValue("tenants", TENANT_ID.acme, "name")).toBe("Acme A");
  expect(await dbValue("tenants", TENANT_ID.acme, "max_concurrent_sub")).toBe(5);
  expect(await versionOf("tenants", TENANT_ID.acme)).toBe(latest + 1);
});

test("ADM-FR-55 · M3-AC08 · tenant: Tải bản mới → toast, form hiện max_concurrent_sub của người kia và tên cũ; DB giữ bản của người kia (v2)", async ({
  page,
  request,
}) => {
  const { latest, name } = await conflictOnAcme(page, request);
  await reloadLatest(page, latest);
  await expect(name).toHaveValue("Acme Corp");
  expect(await dbValue("tenants", TENANT_ID.acme, "max_concurrent_sub")).toBe(7);
  expect(await versionOf("tenants", TENANT_ID.acme)).toBe(latest);
});
