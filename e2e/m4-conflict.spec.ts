// ADM-FR-55 · M4-R17 · M4-AC14 · e2e ConflictDialog có {user} cho User và Tenant, câu 'Lịch sử vẫn giữ v{n}.' (test-plan-ab-e2e E21).
import { expect, test } from "@playwright/test";
import { conflictDialog, expectConflictBody, versionOf } from "./support/conflict";
import { apiAsAdmin, loginAdmin, resetFixture, rowOf, TENANT_ID, USER_ID } from "./support/helpers";

test.beforeEach(() => {
  resetFixture();
});

async function overwriteWithHistory(page: import("@playwright/test").Page, latest: number) {
  await conflictDialog(page).getByRole("button", { name: "Ghi đè", exact: true }).click();
  const confirm = page.getByRole("alertdialog", { name: "Ghi đè thay đổi của admin?" });
  await expect(confirm).toContainText(`Lịch sử vẫn giữ v${latest}.`);
  await confirm.getByRole("button", { name: "Ghi đè", exact: true }).click();
  await expect(conflictDialog(page)).toHaveCount(0);
}

test("M4-R17 · M4-AC14 · E21 · user lan: admin (API) lưu trước → 'admin vừa sửa user này lúc … (v{n}). Bản của bạn dựa trên v{m}.'; Ghi đè → 'Lịch sử vẫn giữ v{n}.'", async ({
  page,
  request,
}) => {
  await loginAdmin(page);
  await page.goto("/users?tenant=acme");
  await rowOf(page, "Users", "lan").getByRole("button", { name: "Thao tác khác" }).click();
  await page.getByRole("menuitem", { name: "Sửa", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: /lan · Lan Tran/ });
  await drawer.getByRole("textbox", { name: "Tên hiển thị" }).fill("Lan Tran A");
  const mine = await versionOf("users", USER_ID.lan);
  const api = await apiAsAdmin(request);
  const theirs = await api.patch(`/admin/users/${USER_ID.lan}`, {
    version: mine,
    display_name: "Lan Tran B",
  });
  expect(theirs.status()).toBe(200);
  await drawer.getByRole("button", { name: "Lưu", exact: true }).click();
  await expectConflictBody(page, { entity: "user", latest: mine + 1, mine, user: "admin" });
  await overwriteWithHistory(page, mine + 1);
});

test("M4-R17 · M4-AC14 · E21 · tenant acme: admin (API) lưu trước → 'admin vừa sửa tenant này lúc … (v{n}). Bản của bạn dựa trên v{m}.'; Ghi đè → 'Lịch sử vẫn giữ v{n}.'", async ({
  page,
  request,
}) => {
  await loginAdmin(page);
  await page.goto(`/tenants/${TENANT_ID.acme}`);
  await page.getByRole("textbox", { name: "Tên công ty" }).fill("Acme A");
  const mine = await versionOf("tenants", TENANT_ID.acme);
  const api = await apiAsAdmin(request);
  const theirs = await api.patch(`/admin/tenants/${TENANT_ID.acme}`, {
    version: mine,
    max_concurrent_sub: 7,
  });
  expect(theirs.status()).toBe(200);
  await page.getByRole("button", { name: "Lưu", exact: true }).click();
  await expectConflictBody(page, { entity: "tenant", latest: mine + 1, mine, user: "admin" });
  await overwriteWithHistory(page, mine + 1);
});
