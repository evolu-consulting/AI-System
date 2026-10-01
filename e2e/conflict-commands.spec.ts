// ADM-FR-55 · M3-AC08 · ConflictDialog cho Command: editor + Switch ở danh sách — câu CÓ {user} (A4). Test-plan E-CC.
// (Ca AC-A07 hai phiên v7 → v8 → v9 của /dich nằm ở m3-flow.spec.ts.)
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

/** Editor /dich: mình sửa Mô tả = "Mô tả A"; người kia (API) sửa = "Mô tả B"; rồi Lưu. */
async function conflictOnEditor(page: Page, request: Parameters<typeof apiAsAdmin>[0]) {
  await loginAdmin(page);
  await page.goto(`/commands/${ID.command.dich}`);
  const desc = page.getByRole("textbox", { name: "Mô tả", exact: true });
  await expect(desc).toBeVisible();
  await desc.fill("Mô tả A");
  const mine = await versionOf("commands", ID.command.dich);
  const api = await apiAsAdmin(request);
  const theirs = await api.patch(`/admin/commands/${ID.command.dich}`, {
    version: mine,
    description: { vi: "Mô tả B" },
  });
  expect(theirs.status()).toBe(200);
  await page.getByRole("button", { name: "Lưu", exact: true }).click();
  return { mine, latest: mine + 1, desc };
}

test("ADM-FR-55 · M3-AC08 · command editor: alertdialog CÓ {user}; diff chỉ có description.vi (không workflow_id); Ghi đè → version +2, Mô tả của mình", async ({
  page,
  request,
}) => {
  const { mine, latest } = await conflictOnEditor(page, request);
  await expectConflictBody(page, { entity: "command", latest, mine, user: "admin" });
  await expectDiff(page, {
    latest,
    fields: ["description.vi"],
    absent: ["workflow_id", "version"],
  });
  await overwrite(page, { latest, user: "admin" });
  expect(await versionOf("commands", ID.command.dich)).toBe(latest + 1);
  expect(await dbValue("commands", ID.command.dich, "description->>'vi'")).toBe("Mô tả A");
});

test("ADM-FR-55 · M3-AC08 · command editor: Tải bản mới → toast, ô Mô tả hiện 'Mô tả B' của người kia; DB không đổi", async ({
  page,
  request,
}) => {
  const { latest, desc } = await conflictOnEditor(page, request);
  await reloadLatest(page, latest);
  await expect(desc).toHaveValue("Mô tả B");
  expect(await dbValue("commands", ID.command.dich, "description->>'vi'")).toBe("Mô tả B");
  expect(await versionOf("commands", ID.command.dich)).toBe(latest);
});

test("ADM-FR-55 · M3-AC08 · command danh sách: tắt switch 'Bật command /dich' khi người kia đã sửa → ConflictDialog (diff dòng enabled); Tải bản mới → toast, switch về trạng thái server (bật)", async ({
  page,
  request,
}) => {
  await loginAdmin(page);
  await openPage(page, "/commands", "Commands");
  const sw = page
    .getByRole("table", { name: "Commands" })
    .getByRole("row")
    .filter({ hasText: /(?<![\w-])dich(?![\w-])/ })
    .getByRole("switch", { name: "Bật command /dich" });
  await expect(sw).toBeChecked();
  const mine = await versionOf("commands", ID.command.dich);
  const api = await apiAsAdmin(request);
  const theirs = await api.patch(`/admin/commands/${ID.command.dich}`, {
    version: mine,
    description: { vi: "Đã đổi" },
  });
  expect(theirs.status()).toBe(200);
  await sw.click();
  await expectConflictBody(page, { entity: "command", latest: mine + 1, mine, user: "admin" });
  await expectDiff(page, { latest: mine + 1, fields: ["enabled"], absent: ["workflow_id"] });
  await reloadLatest(page, mine + 1);
  expect(await dbValue("commands", ID.command.dich, "enabled")).toBe(true);
  await expect(sw).toBeChecked();
});
