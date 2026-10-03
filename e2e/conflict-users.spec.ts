// ADM-FR-55 · M3-AC08 · M4-R17 · ConflictDialog cho User (drawer sửa). M4 (Q2a, test-plan §5 K9): User có `updated_by`
// → ca 1 (admin lưu trước) hiện câu có {user} = "admin"; ca 2 giữ nguyên.
// Khoá/mở khoá user không nhận version nên không có 409 (test-plan G5): không có ca ở đây. Test-plan E-CU.
import { expect, type Page, test } from "@playwright/test";
import {
  dbValue,
  expectConflictBody,
  expectDiff,
  overwrite,
  reloadLatest,
  versionOf,
} from "./support/conflict";
import { apiAsAdmin, loginAdmin, resetFixture, rowOf, USER_ID } from "./support/helpers";

test.describe.configure({ mode: "serial" });
test.beforeEach(() => {
  resetFixture();
});

/** Mở drawer sửa `lan`, đổi Tên hiển thị thành "Lan Tran A", người kia (API) đổi thành "Lan Tran B", rồi bấm Lưu. */
async function conflictOnLan(page: Page, request: Parameters<typeof apiAsAdmin>[0]) {
  await loginAdmin(page);
  await page.goto("/users?tenant=acme");
  await expect(page.getByRole("table", { name: "Users" })).toBeVisible();
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
  return { mine, latest: mine + 1, drawer };
}

test("ADM-FR-55 · M3-AC08 · M4-R17 · user: sửa tên khi admin đã lưu → alertdialog có {user} = admin; Xem khác biệt chỉ có display_name; Ghi đè → version +2 và tên của mình", async ({
  page,
  request,
}) => {
  const { mine, latest } = await conflictOnLan(page, request);
  await expectConflictBody(page, { entity: "user", latest, mine, user: "admin" });
  await expectDiff(page, {
    latest,
    fields: ["display_name"],
    absent: ["email", "version", "updated_at"],
  });
  await overwrite(page, { latest, user: "admin" });
  expect(await dbValue("users", USER_ID.lan, "display_name")).toBe("Lan Tran A");
  expect(await versionOf("users", USER_ID.lan)).toBe(latest + 1);
});

test("ADM-FR-55 · M3-AC08 · user: Tải bản mới → toast 'Đã tải bản mới nhất · v2', form hiện tên của người kia, DB không đổi (không ghi đè âm thầm)", async ({
  page,
  request,
}) => {
  const { latest, drawer } = await conflictOnLan(page, request);
  await reloadLatest(page, latest);
  await expect(drawer.getByRole("textbox", { name: "Tên hiển thị" })).toHaveValue("Lan Tran B");
  expect(await dbValue("users", USER_ID.lan, "display_name")).toBe("Lan Tran B");
  expect(await versionOf("users", USER_ID.lan)).toBe(latest);
});
