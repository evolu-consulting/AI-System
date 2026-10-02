// ADM-FR-55 · M3-AC08 · ConflictDialog cho Group (hộp thoại "Đổi tên group") — câu CÓ {user} (A4). Test-plan E-CG.
// AlertDialog không đóng bằng Escape hay click nền.
import { expect, type Page, test } from "@playwright/test";
import {
  conflictDialog,
  dbValue,
  expectConflictBody,
  expectDiff,
  overwrite,
  reloadLatest,
  versionOf,
} from "./support/conflict";
import { apiAsAdmin, ID3, loginAdmin, resetFixture } from "./support/helpers";

test.describe.configure({ mode: "serial" });
test.beforeEach(() => {
  resetFixture();
});

const KT = ID3.group.acmeKeToan;

/** Mở "Đổi tên group", mình sửa Mô tả = "Mô tả A"; người kia (API) đổi tên = "KT B"; rồi Lưu. */
async function conflictOnRename(page: Page, request: Parameters<typeof apiAsAdmin>[0]) {
  await loginAdmin(page);
  await page.goto(`/groups/${KT}?tenant=acme`);
  await page.getByRole("button", { name: "Đổi tên", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Đổi tên group" });
  await dialog.getByRole("textbox", { name: "Mô tả", exact: true }).fill("Mô tả A");
  const mine = await versionOf("groups", KT);
  const api = await apiAsAdmin(request);
  const theirs = await api.patch(`/admin/groups/${KT}`, { version: mine, name: { vi: "KT B" } });
  expect(theirs.status()).toBe(200);
  await dialog.getByRole("button", { name: "Lưu", exact: true }).click();
  return { mine, latest: mine + 1 };
}

test("ADM-FR-55 · M3-AC08 · group: alertdialog CÓ {user} (entity 'group'); Escape và click nền KHÔNG đóng; diff có name.vi và description; Ghi đè → version +2, Mô tả của mình", async ({
  page,
  request,
}) => {
  const { mine, latest } = await conflictOnRename(page, request);
  await expectConflictBody(page, { entity: "group", latest, mine, user: "admin" });
  await page.keyboard.press("Escape");
  await expect(conflictDialog(page)).toBeVisible();
  await page.mouse.click(4, 4);
  await expect(conflictDialog(page)).toBeVisible();
  await expectDiff(page, {
    latest,
    fields: ["name.vi", "description"],
    absent: ["key", "version"],
  });
  await overwrite(page, { latest, user: "admin" });
  expect(await dbValue("groups", KT, "description")).toBe("Mô tả A");
  expect(await versionOf("groups", KT)).toBe(latest + 1);
});

test("ADM-FR-55 · M3-AC08 · group: Tải bản mới → toast, tiêu đề trang hiện tên của người kia 'KT B'; DB không đổi", async ({
  page,
  request,
}) => {
  const { latest } = await conflictOnRename(page, request);
  await reloadLatest(page, latest);
  await expect(page.getByRole("heading", { level: 1, name: "KT B" })).toBeVisible();
  expect(await versionOf("groups", KT)).toBe(latest);
});

test("ADM-FR-55 · M3-AC08 · group: sau Ghi đè form dựng lại đúng version — lưu tiếp (đổi Mô tả) thành công, version +3, không 409 nữa", async ({
  page,
  request,
}) => {
  const { latest } = await conflictOnRename(page, request);
  await overwrite(page, { latest, user: "admin" });
  await page.getByRole("button", { name: "Đổi tên", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Đổi tên group" });
  await dialog.getByRole("textbox", { name: "Mô tả", exact: true }).fill("Mô tả C");
  const saved = page.waitForResponse(
    (r) => r.url().includes("/admin/groups/") && r.request().method() === "PATCH",
  );
  await dialog.getByRole("button", { name: "Lưu", exact: true }).click();
  expect((await saved).status()).toBe(200);
  await expect(conflictDialog(page)).toHaveCount(0);
  expect(await versionOf("groups", KT)).toBe(latest + 2);
  expect(await dbValue("groups", KT, "description")).toBe("Mô tả C");
});
