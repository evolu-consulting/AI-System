// ADM-FR-55 · M3-AC08 · ConflictDialog cho Workflow: editor + công tắc ở danh sách — câu CÓ {user} (A4, workflow có updated_by).
// TECH-DEBT #14: sau Ghi đè/Tải bản mới form dựng lại đúng version. Test-plan E-CW.
import { expect, type Page, test } from "@playwright/test";
import {
  dbValue,
  expectConflictBody,
  expectDiff,
  overwrite,
  reloadLatest,
  versionOf,
} from "./support/conflict";
import { apiAsAdmin, ID, loginAdmin, openPage, resetFixture } from "./support/helpers";

test.describe.configure({ mode: "serial" });
test.beforeEach(() => {
  resetFixture();
});

const THEIR_DESC = "Mô tả do người kia sửa cho workflow translate";

/** Editor translate: mình đổi Tên → "Translate A"; người kia đổi Mô tả; rồi bấm Lưu. */
async function conflictOnEditor(page: Page, request: Parameters<typeof apiAsAdmin>[0]) {
  await loginAdmin(page);
  await page.goto(`/workflows/${ID.workflow.translate}`);
  await expect(page.getByRole("textbox", { name: "Key", exact: true })).toBeVisible();
  const name = page.getByRole("textbox", { name: "Tên", exact: true });
  await name.fill("Translate A");
  const mine = await versionOf("workflows", ID.workflow.translate);
  const api = await apiAsAdmin(request);
  const theirs = await api.patch(`/admin/workflows/${ID.workflow.translate}`, {
    version: mine,
    description: THEIR_DESC,
  });
  expect(theirs.status()).toBe(200);
  await page.getByRole("button", { name: "Lưu", exact: true }).click();
  return { mine, latest: mine + 1, name };
}

test("ADM-FR-55 · M3-AC08 · workflow editor: alertdialog CÓ {user} ('admin vừa sửa workflow này…'); diff có name và description, không base_url; Ghi đè (tiêu đề 'Ghi đè thay đổi của admin?') → version +2, Tên của mình", async ({
  page,
  request,
}) => {
  const { mine, latest } = await conflictOnEditor(page, request);
  await expectConflictBody(page, { entity: "workflow", latest, mine, user: "admin" });
  await expectDiff(page, {
    latest,
    fields: ["name", "description"],
    absent: ["base_url", "version"],
  });
  await overwrite(page, { latest, user: "admin" });
  expect(await dbValue("workflows", ID.workflow.translate, "name")).toBe("Translate A");
  expect(await versionOf("workflows", ID.workflow.translate)).toBe(latest + 1);
});

test("ADM-FR-55 · M3-AC08 · workflow editor: Tải bản mới → toast v2, ô Mô tả hiện bản của người kia, DB giữ bản của người kia; TECH-DEBT #14: form dựng lại đúng version (lưu tiếp được → v3)", async ({
  page,
  request,
}) => {
  const { latest, name } = await conflictOnEditor(page, request);
  await reloadLatest(page, latest);
  await expect(page.getByRole("textbox", { name: "Mô tả", exact: true })).toHaveValue(THEIR_DESC);
  expect(await dbValue("workflows", ID.workflow.translate, "name")).not.toBe("Translate A");
  await name.fill("Translate C");
  await page.getByRole("button", { name: "Lưu", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: /Đã lưu/ })).toBeVisible();
  expect(await versionOf("workflows", ID.workflow.translate)).toBe(latest + 1);
});

test("ADM-FR-55 · M3-AC08 · workflow danh sách: bật report-export khi người kia đã sửa → ConflictDialog (diff một dòng enabled); Tải bản mới → toast + hàng cập nhật; không còn nút 'Tải lại'", async ({
  page,
  request,
}) => {
  await loginAdmin(page);
  await openPage(page, "/workflows", "Workflows");
  const row = page
    .getByRole("table", { name: "Workflows" })
    .getByRole("row")
    .filter({ hasText: "report-export" });
  const mine = await versionOf("workflows", ID.workflow.reportExport);
  const api = await apiAsAdmin(request);
  const theirs = await api.patch(`/admin/workflows/${ID.workflow.reportExport}`, {
    version: mine,
    name: "Report export sửa",
  });
  expect(theirs.status()).toBe(200);
  await row.getByRole("button", { name: "Thao tác khác" }).click();
  await page.getByRole("menuitem", { name: "Bật", exact: true }).click();
  await expectConflictBody(page, { entity: "workflow", latest: mine + 1, mine, user: "admin" });
  await expectDiff(page, {
    latest: mine + 1,
    fields: ["enabled"],
    absent: ["base_url", "description"],
  });
  await reloadLatest(page, mine + 1);
  expect(await dbValue("workflows", ID.workflow.reportExport, "enabled")).toBe(false);
  await expect(row).toContainText("Report export sửa");
});
